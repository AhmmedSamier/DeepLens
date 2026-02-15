using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using StreamJsonRpc;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace DeepLensVisualStudio.Services
{
    public class LspSearchItem
    {
        [JsonProperty("name")] public string Name { get; set; } = "";
        [JsonProperty("type")] public string Type { get; set; } = "";
        [JsonProperty("filePath")] public string FilePath { get; set; } = "";
        [JsonProperty("line")] public int? Line { get; set; }
        [JsonProperty("column")] public int? Column { get; set; }
        [JsonProperty("containerName")] public string ContainerName { get; set; } = "";
    }

    public class LspSearchResult
    {
        [JsonProperty("item")] public LspSearchItem Item { get; set; } = new LspSearchItem();
        [JsonProperty("score")] public double Score { get; set; }
        [JsonProperty("highlights")] public int[][]? Highlights { get; set; }
    }

    public class LspSearchService : IDisposable
    {
        private Process? _nodeProcess;
        private JsonRpc? _rpc;
        private string? _lastError;
        private SearchTimings _lastTimings = new SearchTimings();
        private bool _isInitialized;
        private bool _firstRecorded;
        private Stopwatch _searchSw = new Stopwatch();
        private static Guid DeepLensPaneGuid = new Guid("80a30b7a-c165-450f-9723-936612056686");

        public string? LastError => _lastError;
        public SearchTimings LastTimings => _lastTimings;
        public string? ActiveRuntime { get; private set; }
        public string? CurrentWorkspacePath { get; private set; }
        
        /// <summary>
        /// Indicates whether the LSP server is currently indexing.
        /// </summary>
        public bool IsIndexing { get; private set; }

        /// <summary>
        /// Event fired when progress is reported during indexing.
        /// </summary>
        public event Action<ProgressInfo>? OnProgress;

        /// <summary>
        /// Static event that can be subscribed to from package initialization.
        /// </summary>
        public static event Action<ProgressInfo>? StaticOnProgress;

        private void Log(string message, LogLevel level = LogLevel.Info, Exception? exception = null)
        {
            var levelPrefix = level switch
            {
                LogLevel.Error => "[ERROR]",
                LogLevel.Warning => "[WARN]",
                LogLevel.Info => "[INFO]",
                _ => "[DEBUG]"
            };

            var logMessage = $"[{DateTime.Now:HH:mm:ss}] {levelPrefix} {message}";
            
            if (exception != null)
            {
                logMessage += $"\n  Exception: {exception.Message}";
                if (exception.StackTrace != null)
                {
                    logMessage += $"\n  Stack Trace:\n{exception.StackTrace}";
                }
            }

            Debug.WriteLine($"DeepLens: {logMessage}");
            
            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                try
                {
                    if (ServiceProvider.GlobalProvider.GetService(typeof(SVsOutputWindow)) is IVsOutputWindow outputWindow)
                    {
                        IVsOutputWindowPane pane;
                        outputWindow.GetPane(ref DeepLensPaneGuid, out pane);
                        if (pane == null)
                        {
                            outputWindow.CreatePane(ref DeepLensPaneGuid, "DeepLens", 1, 1);
                            outputWindow.GetPane(ref DeepLensPaneGuid, out pane);
                        }
                        pane?.OutputStringThreadSafe($"{logMessage}\n");
                        
                        // Show pane for errors
                        if (level == LogLevel.Error)
                        {
                            pane?.Activate();
                        }
                    }
                }
                catch { }
            });
        }

        private enum LogLevel
        {
            Debug,
            Info,
            Warning,
            Error
        }

        public async Task<bool> InitializeAsync(string solutionPath, CancellationToken ct)
        {
            // If already initialized for a different workspace, reinitialize
            if (_isInitialized && !string.Equals(CurrentWorkspacePath, solutionPath, StringComparison.OrdinalIgnoreCase))
            {
                await ReinitializeAsync(solutionPath, ct);
                return _isInitialized;
            }
            
            if (_isInitialized) return true;

            if (string.IsNullOrEmpty(solutionPath))
            {
                // If no solution is open, we can't initialize LSP properly with a workspace.
                // We'll wait for a solution to be opened.
                _lastError = "No solution or folder open. DeepLens LSP will initialize when a workspace is available.";
                return false;
            }

            try
            {
                string extensionDir = Path.GetDirectoryName(typeof(LspSearchService).Assembly.Location) ?? "";
                string? serverPath = FindServerPath(extensionDir);

                if (string.IsNullOrEmpty(serverPath))
                {
                    _lastError = "LSP Error: server.js not found in extension or language-server/dist";
                    return false;
                }

                try
                {
                    string runtime = "bun";
                    try
                    {
                        var bunCheck = new Process
                        {
                            StartInfo = new ProcessStartInfo
                            {
                                FileName = "bun",
                                Arguments = "--version",
                                UseShellExecute = false,
                                RedirectStandardOutput = true,
                                CreateNoWindow = true
                            }
                        };
                        bunCheck.Start();
                        bunCheck.WaitForExit();
                    }
                    catch
                    {
                        runtime = "node";
                    }

                    _nodeProcess = new Process
                    {
                        StartInfo = new ProcessStartInfo
                        {
                            FileName = runtime,
                            Arguments = $"\"{serverPath}\" --stdio",
                            UseShellExecute = false,
                            RedirectStandardInput = true,
                            RedirectStandardOutput = true,
                            RedirectStandardError = true,
                            CreateNoWindow = true
                        }
                    };

                    _nodeProcess.ErrorDataReceived += (s, e) =>
                    {
                        if (!string.IsNullOrEmpty(e.Data))
                        {
                            _lastError = $"LSP Server Error: {e.Data}";
                            Log($"LSP Stderr: {e.Data}");
                        }
                    };

                    _nodeProcess.Start();
                    _nodeProcess.BeginErrorReadLine();
                    ActiveRuntime = runtime;
                    Debug.WriteLine($"DeepLens: Started LSP server using {runtime}");
                }
                catch (System.ComponentModel.Win32Exception)
                {
                    _lastError =
                        "LSP Error: Neither 'bun' nor 'node' found in PATH. Please install Bun (preferred) or Node.js.";
                    return false;
                }

                try
                {
                    _rpc = new JsonRpc(_nodeProcess.StandardInput.BaseStream, _nodeProcess.StandardOutput.BaseStream);

                    // Handle streamed results for timing
                    _rpc.AddLocalRpcMethod("deeplens/streamResult", new Action<JToken>(OnStreamResult));
                    
                    // Handle progress notifications from LSP server
                    _rpc.AddLocalRpcMethod("deeplens/progress", new Action<JToken>(OnProgressNotification));
                    
                    // Handle log messages from LSP server
                    _rpc.AddLocalRpcMethod("window/logMessage", new Action<JToken>(OnLogMessage));
                    _rpc.AddLocalRpcMethod("window/showMessage", new Action<JToken>(OnShowMessage));
                    
                    // Handle the progress token creation request from LSP server
                    _rpc.AddLocalRpcMethod("window/workDoneProgress/create", new Func<JToken, bool>(OnWorkDoneProgressCreate));

                    _rpc.StartListening();
                }
                catch (Exception ex)
                {
                    _lastError = $"Failed to setup RPC: {ex.Message}";
                    Log("Failed to setup RPC", LogLevel.Error, ex);
                    _nodeProcess.Kill();
                    return false;
                }

                // Load settings and pass to LSP server
                var settings = new DeepLensSettings();
                var initializationOptions = new JObject
                {
                    ["storagePath"] = Path.Combine(Path.GetTempPath(), "DeepLens"),
                    ["extensionPath"] = extensionDir,
                    ["maxResults"] = settings.MaxResults,
                    ["enableTextSearch"] = settings.EnableTextSearch,
                    ["enableCamelHumps"] = settings.EnableCamelHumps,
                    ["respectGitignore"] = settings.RespectGitignore,
                    ["searchConcurrency"] = settings.SearchConcurrency,
                    ["activityEnabled"] = settings.ActivityEnabled,
                    ["activityWeight"] = settings.ActivityWeight,
                    ["fileExtensions"] = new JArray(settings.FileExtensions.ToArray()),
                    ["excludePatterns"] = new JArray(settings.ExcludePatterns.ToArray())
                };

                var initializeParams = new JObject
                {
                    ["processId"] = Process.GetCurrentProcess().Id,
                    ["rootPath"] = solutionPath,
                    ["rootUri"] = new Uri(solutionPath).AbsoluteUri,
                    ["capabilities"] = new JObject(),
                    ["initializationOptions"] = initializationOptions
                };

                await _rpc.InvokeWithParameterObjectAsync("initialize", initializeParams);
                await _rpc.NotifyAsync("initialized");

                _isInitialized = true;
                CurrentWorkspacePath = solutionPath;
                return true;
            }
            catch (Exception ex)
            {
                _lastError = $"LSP Init Error: {ex.Message}";
                Log("LSP initialization failed", LogLevel.Error, ex);
                return false;
            }
        }

        /// <summary>
        /// Reinitializes the LSP server for a new solution/workspace.
        /// </summary>
        private async Task ReinitializeAsync(string newSolutionPath, CancellationToken ct)
        {
            Debug.WriteLine($"DeepLens: Reinitializing LSP for new workspace: {newSolutionPath}");
            
            // Shutdown existing process
            Shutdown();
            
            // Reset state
            _isInitialized = false;
            CurrentWorkspacePath = null;
            _lastError = null;
            
            // Initialize with new path
            await InitializeAsync(newSolutionPath, ct);
        }

        /// <summary>
        /// Cleanly shuts down the LSP server process.
        /// </summary>
        private void Shutdown()
        {
            try
            {
                _rpc?.Dispose();
            }
            catch { }

            if (_nodeProcess != null && !_nodeProcess.HasExited)
            {
                try
                {
                    _nodeProcess.Kill();
                }
                catch { }
            }

            _nodeProcess?.Dispose();
            _nodeProcess = null;
            _rpc = null;
        }

        private void OnStreamResult(JToken parameters)
        {
            if (!_firstRecorded)
            {
                _lastTimings.FirstResultMs = _searchSw.ElapsedMilliseconds;
                _firstRecorded = true;
            }
        }

        private void OnLogMessage(JToken parameters)
        {
            try
            {
                string? message = parameters["message"]?.ToString();
                int? level = parameters["level"]?.Value<int>();
                
                if (!string.IsNullOrEmpty(message))
                {
                    var logLevel = level switch
                    {
                        1 => LogLevel.Error,   // Error
                        2 => LogLevel.Warning,  // Warning
                        3 => LogLevel.Info,     // Info
                        _ => LogLevel.Debug     // Log
                    };
                    Log($"[LSP] {message}", logLevel);
                }
            }
            catch (Exception ex)
            {
                Log("Error processing log message", LogLevel.Warning, ex);
            }
        }

        private void OnShowMessage(JToken parameters)
        {
            try
            {
                string? message = parameters["message"]?.ToString();
                int? type = parameters["type"]?.Value<int>();
                
                if (!string.IsNullOrEmpty(message))
                {
                    var logLevel = type switch
                    {
                        1 => LogLevel.Error,   // Error
                        2 => LogLevel.Warning,  // Warning
                        3 => LogLevel.Info,     // Info
                        _ => LogLevel.Info      // Log
                    };
                    Log($"[LSP Message] {message}", logLevel);
                }
            }
            catch (Exception ex)
            {
                Log("Error processing show message", LogLevel.Warning, ex);
            }
        }

        private bool OnWorkDoneProgressCreate(JToken parameters)
        {
            // Simply acknowledge the progress token creation - the server expects a response
            Log($"Progress token creation requested: {parameters}", LogLevel.Debug);
            return true;
        }

        private void OnProgressNotification(JToken parameters)
        {
            try
            {
                // Debug.WriteLine($"DeepLens: Received progress notification: {parameters}");
                
                string? message = null;
                int? percentage = null;
                
                // Handle different parameter formats
                if (parameters is JObject obj)
                {
                    message = obj["message"]?.ToString();
                    percentage = obj["percentage"]?.Value<int>();
                }
                else
                {
                    // Try to get parameters from root
                    message = parameters["message"]?.ToString();
                    percentage = parameters["percentage"]?.Value<int>();
                }
                
                Log($"Progress - Message: {message}, Percentage: {percentage}", LogLevel.Debug);
                
                // Determine state based on message content
                string state;
                if (message?.StartsWith("Done") == true || percentage == 100)
                {
                    state = "end";
                    IsIndexing = false;
                }
                else if (!IsIndexing)
                {
                    state = "start";
                    IsIndexing = true;
                }
                else
                {
                    state = "report";
                }

                var progressInfo = new ProgressInfo
                {
                    State = state,
                    Message = message,
                    Percentage = percentage
                };
                
                OnProgress?.Invoke(progressInfo);
                StaticOnProgress?.Invoke(progressInfo);
            }
            catch (Exception ex)
            {
                Log("Error processing progress notification", LogLevel.Warning, ex);
            }
        }

        private string? FindServerPath(string extensionDir)
        {
            Debug.WriteLine($"DeepLens: Searching for LSP server in: {extensionDir}");

            // 1. Check relative to extension (production/bundled)
            string[] possiblePaths = new[]
            {
                Path.Combine(extensionDir, "dist", "server.js"),
                Path.Combine(extensionDir, "server.js"),
                Path.Combine(extensionDir, "..", "dist", "server.js"), // In case assembly is in a bin folder
                Path.Combine(extensionDir, "..", "server.js"),
            };

            foreach (var path in possiblePaths)
            {
                if (File.Exists(path))
                {
                    Debug.WriteLine($"DeepLens: Found LSP server at: {path}");
                    return path;
                }
            }

            // 2. Check development path (climb up from bin/Debug/net472/...)
            string current = extensionDir;
            for (int i = 0; i < 10; i++)
            {
                string devPath = Path.Combine(current, "language-server", "dist", "server.js");
                if (File.Exists(devPath))
                {
                    Debug.WriteLine($"DeepLens: Found dev LSP server at: {devPath}");
                    return devPath;
                }

                string? parent = Path.GetDirectoryName(current);
                if (string.IsNullOrEmpty(parent) || parent == current) break;
                current = parent;
            }

            Debug.WriteLine("DeepLens: LSP server (server.js) not found in any expected location.");
            return null;
        }

        public async Task<IEnumerable<SearchResult>> GetRecentItemsAsync(int count, CancellationToken ct)
        {
            if (!_isInitialized || _rpc == null) return Enumerable.Empty<SearchResult>();

            try
            {
                var lspResults = await _rpc.InvokeWithParameterObjectAsync<List<LspSearchResult>>("deeplens/getRecentItems", new { count });
                return lspResults.Select(r => new SearchResult
                {
                    Name = r.Item.Name,
                    Kind = MapLspKind(r.Item.Type),
                    FilePath = r.Item.FilePath,
                    Line = (r.Item.Line ?? 0) + 1,
                    Column = r.Item.Column,
                    Highlights = r.Highlights,
                    ContainerName = r.Item.ContainerName,
                    Score = (int)(r.Score * 10000)
                });
            }
            catch (Exception ex)
            {
                Log("GetRecentItems error", LogLevel.Warning, ex);
                return Enumerable.Empty<SearchResult>();
            }
        }

        public async Task<IEnumerable<SearchResult>> SearchAsync(string query, string scope, CancellationToken ct)
        {
            if (!_isInitialized || _rpc == null)
            {
                // Try one-time auto-init if we have a workspace path
                if (!string.IsNullOrEmpty(CurrentWorkspacePath))
                {
                    await InitializeAsync(CurrentWorkspacePath!, ct);
                }
                
                if (!_isInitialized || _rpc == null) return Enumerable.Empty<SearchResult>();
            }

            _lastTimings = new SearchTimings();
            _firstRecorded = false;
            _searchSw.Restart();

            try
            {
                return await ExecuteSearchInternalAsync(query, scope, ct);
            }
            catch (Exception ex) when (ex is System.IO.IOException || 
                                     ex is ObjectDisposedException || 
                                     ex.GetType().Name.Contains("JsonRpc") ||
                                     ex.GetType().Name.Contains("Rpc"))
            {
                Debug.WriteLine($"DeepLens: LSP Search failed (Connection Lost): {ex.Message}. Attempting re-init...");
                
                // Connection likely lost. Try re-initializing once.
                _isInitialized = false;
                if (!string.IsNullOrEmpty(CurrentWorkspacePath) && await InitializeAsync(CurrentWorkspacePath!, ct))
                {
                    try
                    {
                        return await ExecuteSearchInternalAsync(query, scope, ct);
                    }
                    catch (Exception reinitEx)
                    {
                        _lastError = $"LSP Search Error (after re-init): {reinitEx.Message}";
                    }
                }
                else
                {
                    _lastError = $"LSP Search Error: Connection lost and re-init failed.";
                }
                
                return Enumerable.Empty<SearchResult>();
            }
            catch (Exception ex)
            {
                _lastError = $"LSP Search Error: {ex.Message}";
                Log("LSP search error", LogLevel.Error, ex);
                return Enumerable.Empty<SearchResult>();
            }
        }

        private async Task<IEnumerable<SearchResult>> ExecuteSearchInternalAsync(string query, string scope, CancellationToken ct)
        {
            if (_rpc == null) return Enumerable.Empty<SearchResult>();

            // Load maxResults from settings
            var settings = new DeepLensSettings();
            var searchParams = new JObject
            {
                ["query"] = query,
                ["scope"] = scope,
                ["maxResults"] = settings.MaxResults,
                ["requestId"] = Environment.TickCount
            };


            var lspResults =
                await _rpc.InvokeWithParameterObjectAsync<List<LspSearchResult>>("deeplens/search", searchParams, ct);

            _lastTimings.TotalMs = _searchSw.ElapsedMilliseconds;
            if (!_firstRecorded && lspResults.Any())
            {
                _lastTimings.FirstResultMs = _searchSw.ElapsedMilliseconds;
            }

            return lspResults.Select(r => new SearchResult
            {
                Name = r.Item.Name,
                Kind = MapLspKind(r.Item.Type),
                FilePath = r.Item.FilePath,
                Line = (r.Item.Line ?? 0) + 1,
                Column = r.Item.Column,
                Highlights = r.Highlights,
                ContainerName = r.Item.ContainerName,
                Score = (int)(r.Score * 10000)
            });
        }

        /// <summary>
        /// Gets index statistics from the LSP server.
        /// </summary>
        public async Task<IndexStats?> GetIndexStatsAsync()
        {
            if (!_isInitialized || _rpc == null) return null;

            try
            {
                return await _rpc.InvokeAsync<IndexStats>("deeplens/indexStats");
            }
            catch (Exception ex)
            {
                Log("GetIndexStats error", LogLevel.Warning, ex);
                return null;
            }
        }

        /// <summary>
        /// Triggers a full re-index of the workspace.
        /// </summary>
        public async Task RebuildIndexAsync(bool force = false)
        {
            if (!_isInitialized || _rpc == null) return;

            try
            {
                var rebuildParams = new JObject { ["force"] = force };
                await _rpc.InvokeWithParameterObjectAsync("deeplens/rebuildIndex", rebuildParams);
            }
            catch (Exception ex)
            {
                _lastError = $"LSP Rebuild Error: {ex.Message}";
                Log("RebuildIndex error", LogLevel.Error, ex);
            }
        }

        /// <summary>
        /// Clears the persistent index cache.
        /// </summary>
        public async Task ClearCacheAsync()
        {
            if (!_isInitialized || _rpc == null) return;

            try
            {
                await _rpc.InvokeAsync("deeplens/clearCache");
            }
            catch (Exception ex)
            {
                _lastError = $"LSP Clear Cache Error: {ex.Message}";
                Log("ClearCache error", LogLevel.Error, ex);
            }
        }

        private string MapLspKind(string lspType)
        {
            switch (lspType.ToLower())
            {
                case "file": return "File";
                case "class": return "Class";
                case "interface": return "Interface";
                case "enum": return "Enum";
                case "method": return "Method";
                case "function": return "Function";
                case "property": return "Property";
                case "field": return "Field";
                case "variable": return "Variable";
                case "text": return "Text";
                case "endpoint": return "Endpoint";
                case "command": return "Command";
                case "struct": return "Struct";
                case "namespace": return "Namespace";
                case "event": return "Event";
                case "delegate": return "Delegate";
                case "constructor": return "Constructor";
                default: return "Symbol";
            }
        }

        public async Task RecordActivityAsync(string itemId)
        {
            if (!_isInitialized || _rpc == null) return;

            try
            {
                await _rpc.NotifyWithParameterObjectAsync("deeplens/recordActivity", new { itemId });
            }
            catch (Exception ex)
            {
                Log("RecordActivity error", LogLevel.Warning, ex);
            }
        }

        /// <summary>
        /// Sets the list of active/open files for the /open scope.
        /// </summary>
        public async Task SetActiveFilesAsync(List<string> filePaths)
        {
            if (!_isInitialized || _rpc == null) return;

            try
            {
                await _rpc.InvokeWithParameterObjectAsync("deeplens/setActiveFiles", new { files = filePaths });
            }
            catch (Exception ex)
            {
                Log("SetActiveFiles error", LogLevel.Warning, ex);
            }
        }

        public void Dispose()
        {
            _rpc?.Dispose();
            if (_nodeProcess != null && !_nodeProcess.HasExited)
            {
                try
                {
                    _nodeProcess.Kill();
                }
                catch
                {
                }
            }

            _nodeProcess?.Dispose();
        }
    }
}
