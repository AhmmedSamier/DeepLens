using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;
using StreamJsonRpc;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace DeepLensVisualStudio.Services
{
    public class LspSearchItem
    {
        [JsonProperty("name")] public string Name { get; set; } = "";
        [JsonProperty("type")] public string Type { get; set; } = "";
        [JsonProperty("filePath")] public string FilePath { get; set; } = "";
        [JsonProperty("line")] public int? Line { get; set; }
        [JsonProperty("containerName")] public string ContainerName { get; set; } = "";
    }

    public class LspSearchResult
    {
        [JsonProperty("item")] public LspSearchItem Item { get; set; } = new LspSearchItem();
        [JsonProperty("score")] public double Score { get; set; }
    }

    public class LspSearchService : IDisposable
    {
        private Process? _nodeProcess;
        private JsonRpc? _rpc;
        private string? _lastError;
        private SearchTimings _lastTimings = new SearchTimings();
        private bool _isInitialized = false;
        private bool _firstRecorded = false;
        private Stopwatch _searchSw = new Stopwatch();

        public string? LastError => _lastError;
        public SearchTimings LastTimings => _lastTimings;
        public string? ActiveRuntime { get; private set; }

        public async Task<bool> InitializeAsync(string solutionPath, CancellationToken ct)
        {
            if (_isInitialized) return true;

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
                    bool startSucceeded = false;

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
                        startSucceeded = true;
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
                            Debug.WriteLine($"[DeepLens LSP Stderr] {e.Data}");
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

                _rpc = new JsonRpc(_nodeProcess.StandardInput.BaseStream, _nodeProcess.StandardOutput.BaseStream);

                // Handle streamed results for timing
                _rpc.AddLocalRpcMethod("deeplens/streamResult", new Action<JToken>(OnStreamResult));

                _rpc.StartListening();

                var initializeParams = new JObject
                {
                    ["processId"] = Process.GetCurrentProcess().Id,
                    ["rootPath"] = solutionPath,
                    ["rootUri"] = new Uri(solutionPath).AbsoluteUri,
                    ["capabilities"] = new JObject(),
                    ["initializationOptions"] = new JObject
                    {
                        ["storagePath"] = Path.Combine(Path.GetTempPath(), "DeepLens"),
                        ["extensionPath"] = Path.GetDirectoryName(serverPath)
                    }
                };

                await _rpc.InvokeWithParameterObjectAsync("initialize", initializeParams);
                await _rpc.NotifyAsync("initialized");

                _isInitialized = true;
                return true;
            }
            catch (Exception ex)
            {
                _lastError = $"LSP Init Error: {ex.Message}";
                Debug.WriteLine($"[DeepLens] {_lastError}");
                return false;
            }
        }

        private void OnStreamResult(JToken parameters)
        {
            if (!_firstRecorded)
            {
                _lastTimings.FirstResultMs = _searchSw.ElapsedMilliseconds;
                _firstRecorded = true;
            }
        }

        private string? FindServerPath(string extensionDir)
        {
            // 1. Check relative to extension (production/bundled)
            string prodPath = Path.Combine(extensionDir, "server.js");
            if (File.Exists(prodPath)) return prodPath;

            // 2. Check development path
            string devPath =
                Path.GetFullPath(Path.Combine(extensionDir, "..\\..\\..\\..\\..\\language-server\\dist\\server.js"));
            if (File.Exists(devPath)) return devPath;

            return null;
        }

        public async Task<IEnumerable<SearchResult>> SearchAsync(string query, string scope, CancellationToken ct)
        {
            if (!_isInitialized || _rpc == null) return Enumerable.Empty<SearchResult>();

            _lastTimings = new SearchTimings();
            _firstRecorded = false;
            _searchSw.Restart();

            try
            {
                var searchParams = new JObject
                {
                    ["query"] = query,
                    ["scope"] = scope,
                    ["maxResults"] = 50,
                    ["requestId"] = Environment.TickCount
                };

                var lspResults =
                    await _rpc.InvokeWithParameterObjectAsync<List<LspSearchResult>>("deeplens/search", searchParams);

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
                    ContainerName = r.Item.ContainerName,
                    Score = (int)(r.Score * 10000)
                });
            }
            catch (Exception ex)
            {
                _lastError = $"LSP Search Error: {ex.Message}";
                return Enumerable.Empty<SearchResult>();
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
