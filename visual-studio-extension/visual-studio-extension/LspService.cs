using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipelines;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Extensibility;
using StreamJsonRpc;
using System.Collections.Generic;

namespace visual_studio_extension
{
    public enum SearchScope
    {
        EVERYTHING = 0,
        TYPES = 1,
        SYMBOLS = 2,
        FILES = 3,
        COMMANDS = 4,
        PROPERTIES = 5,
        ENDPOINTS = 6
    }

    public enum SearchItemType
    {
        FILE = 0,
        CLASS = 1,
        INTERFACE = 2,
        ENUM = 3,
        FUNCTION = 4,
        METHOD = 5,
        PROPERTY = 6,
        VARIABLE = 7,
        TEXT = 8,
        COMMAND = 9,
        ENDPOINT = 10
    }

    public class SearchItem
    {
        public string id { get; set; } = "";
        public string name { get; set; } = "";
        public string detail { get; set; } = "";
        public SearchItemType type { get; set; }
        public string filePath { get; set; } = "";
        public int? line { get; set; }
        public int? column { get; set; }
        public string containerName { get; set; } = "";
        public string commandId { get; set; } = "";
    }

    public class SearchResult
    {
        public SearchItem item { get; set; } = new();
        public double score { get; set; }
        public List<int>? matches { get; set; }
    }

    public class SearchOptions
    {
        public string query { get; set; } = "";
        public SearchScope scope { get; set; }
        public int maxResults { get; set; } = 50;
        public bool enableCamelHumps { get; set; } = true;
    }

    public class LspService : IDisposable
    {
        private Process? _serverProcess;
        private JsonRpc? _rpc;
        private readonly ExtensionEntrypoint _extension;
        private bool _isInitialized = false;

        public bool IsInitialized => _isInitialized;

        public LspService(ExtensionEntrypoint extension)
        {
            _extension = extension;
        }

        public async Task InitializeAsync(string rootPath, CancellationToken cancellationToken)
        {
            if (_isInitialized) return;

            try
            {
                string extensionPath = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location) ?? "";
                string serverPath = Path.Combine(extensionPath, "Resources", "deeplens-lsp.exe");

                if (!File.Exists(serverPath))
                {
                    // Fallback to searching up from bin/Debug/...
                    // This is hacky but helps in dev environment if not properly deployed
                     string? current = extensionPath;
                     while(current != null && !File.Exists(Path.Combine(current, "Resources", "deeplens-lsp.exe")))
                     {
                         current = Directory.GetParent(current)?.FullName;
                     }
                     if (current != null)
                     {
                         serverPath = Path.Combine(current, "Resources", "deeplens-lsp.exe");
                     }
                }

                if (!File.Exists(serverPath))
                {
                    throw new FileNotFoundException($"LSP executable not found at {serverPath}");
                }

                var startInfo = new ProcessStartInfo
                {
                    FileName = serverPath,
                    Arguments = "--stdio",
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true, // Log stderr
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                _serverProcess = Process.Start(startInfo);
                if (_serverProcess == null)
                {
                    throw new InvalidOperationException("Failed to start LSP process.");
                }

                // Log stderr
                _ = Task.Run(async () =>
                {
                    while (!_serverProcess.HasExited)
                    {
                        var line = await _serverProcess.StandardError.ReadLineAsync();
                        if (line != null)
                        {
                            Debug.WriteLine($"[LSP Stderr]: {line}");
                        }
                    }
                });

                var messageHandler = new HeaderDelimitedMessageHandler(
                    _serverProcess.StandardInput.BaseStream,
                    _serverProcess.StandardOutput.BaseStream);

                _rpc = new JsonRpc(messageHandler);

                // Register notification handlers
                _rpc.AddLocalRpcTarget(this);

                _rpc.StartListening();

                // Initialize Request
                // We need to mimic LSP initialize params roughly
                var initParams = new
                {
                    processId = Process.GetCurrentProcess().Id,
                    rootUri = new Uri(rootPath).ToString(),
                    capabilities = new { },
                    initializationOptions = new
                    {
                        storagePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "DeepLens"),
                        extensionPath = extensionPath
                    }
                };

                await _rpc.InvokeWithParameterObjectAsync("initialize", initParams);
                await _rpc.NotifyAsync("initialized", new object());

                _isInitialized = true;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"LSP Initialization failed: {ex}");
                throw;
            }
        }

        [JsonRpcMethod("deeplens/progress")]
        public void OnProgress(string token, string message, int? percentage)
        {
            // TODO: Expose progress to UI
            Debug.WriteLine($"[Progress] {message} {percentage}%");
        }

        public async Task<SearchResult[]> SearchAsync(string query, SearchScope scope)
        {
            if (_rpc == null || !_isInitialized) return Array.Empty<SearchResult>();

            var options = new SearchOptions
            {
                query = query,
                scope = scope,
                maxResults = 50
            };

            return await _rpc.InvokeAsync<SearchResult[]>("deeplens/search", options);
        }

        public async Task<SearchResult[]> BurstSearchAsync(string query, SearchScope scope)
        {
            if (_rpc == null || !_isInitialized) return Array.Empty<SearchResult>();

             var options = new SearchOptions
            {
                query = query,
                scope = scope,
                maxResults = 20
            };

            return await _rpc.InvokeAsync<SearchResult[]>("deeplens/burstSearch", options);
        }

        public async Task RebuildIndexAsync(bool force)
        {
             if (_rpc == null || !_isInitialized) return;
             await _rpc.InvokeAsync("deeplens/rebuildIndex", new { force });
        }

        public async Task ClearCacheAsync()
        {
             if (_rpc == null || !_isInitialized) return;
             await _rpc.InvokeAsync("deeplens/clearCache");
        }

        public void Dispose()
        {
            _rpc?.Dispose();
            if (_serverProcess != null && !_serverProcess.HasExited)
            {
                _serverProcess.Kill();
                _serverProcess.Dispose();
            }
        }
    }
}
