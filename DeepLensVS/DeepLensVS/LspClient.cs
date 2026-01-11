using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;
using System.Collections.Concurrent;
using System.Text;

namespace DeepLensVS
{
    public class LspClient
    {
        private Process? serverProcess;
        private StreamWriter? writer;
        private StreamReader? reader;
        private int requestId = 0;
        private readonly ConcurrentDictionary<int, TaskCompletionSource<JsonElement>> pendingRequests = new();
        private bool isRunning = false;
        public bool IsRunning => isRunning && serverProcess != null && !serverProcess.HasExited;

        public event Action<string, JsonElement>? NotificationReceived;
        public Action<double>? OnIndexingProgress;

        public double IndexingProgress { get; private set; } = 100;

        public async Task StartAsync(string fileName, string arguments = "", object? initializationOptions = null, string? rootUri = null)
        {
            if (serverProcess != null && !serverProcess.HasExited) return;

            serverProcess = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = fileName,
                    Arguments = arguments,
                    RedirectStandardInput = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = System.IO.Path.GetDirectoryName(fileName)
                }
            };

            try 
            {
                serverProcess.Start();
                Logger.Log($"LSP Process Started. ID: {serverProcess.Id}");
            }
            catch (Exception ex)
            {
                Logger.LogError("Failed to start LSP process", ex);
                throw;
            }

            writer = new StreamWriter(serverProcess.StandardInput.BaseStream, new UTF8Encoding(false));
            reader = new StreamReader(serverProcess.StandardOutput.BaseStream, Encoding.UTF8);
            
            isRunning = true;
            _ = ReadLoopAsync();

            // Simple initialization
            Logger.Log("Sending initialize request...");
            await SendRequestAsync<JsonElement>("initialize", new { 
                processId = Process.GetCurrentProcess().Id,
                rootUri = rootUri,
                capabilities = new { 
                    workspace = new {
                        workspaceFolders = true,
                        configuration = true
                    }
                },
                initializationOptions = initializationOptions
            });

            Logger.Log("Sending initialized notification...");
            await SendNotificationAsync("initialized", new { });
        }

        private async Task ReadLoopAsync()
        {
            try
            {
                while (isRunning && reader != null)
                {
                    string? line = await reader.ReadLineAsync();
                    if (line == null) break;
                    if (string.IsNullOrEmpty(line)) continue;

                    if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase))
                    {
                        int length = int.Parse(line.Substring("Content-Length:".Length).Trim());
                        
                        // Skip lines until we find the empty line separating headers from body
                        while (!string.IsNullOrEmpty(await reader.ReadLineAsync())) { }

                        char[] buffer = new char[length];
                        int totalRead = 0;
                        while (totalRead < length)
                        {
                            int read = await reader.ReadAsync(buffer, totalRead, length - totalRead);
                            if (read == 0) break;
                            totalRead += read;
                        }

                        if (totalRead == length)
                        {
                            string json = new string(buffer);
                            ProcessMessage(json);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"LSP Read Error: {ex}");
            }
        }

            private void ProcessMessage(string json)
            {
                try
                {
                    // Log incoming message (truncate if too long)
                    string logMsg = json.Length > 200 ? json.Substring(0, 200) + "..." : json;
                    Logger.Log($"LSP RECV: {logMsg}");

                    using var doc = JsonDocument.Parse(json);
                    var root = doc.RootElement;

                if (root.TryGetProperty("id", out var idProp))
                {
                    // If it has a method, it's a Request from Server (e.g. window/workDoneProgress/create)
                    if (root.TryGetProperty("method", out var methodProp))
                    {
                        var method = methodProp.GetString();
                        var id = idProp.Clone(); // Clone ID for response

                        // Respond immediately to unblock server
                        // For workDoneProgress/create, we just acknowledge it
                        // For client/registerCapability, we also just acknowledge it
                        _ = SendResponseAsync(id, null);

                        Logger.Log($"Server Request Handled: {method} (ID: {id})");
                    }
                    else
                    {
                        // It's a Response to OUR request
                        int id = idProp.GetInt32();
                        if (pendingRequests.TryRemove(id, out var tcs))
                        {
                            if (root.TryGetProperty("result", out var result))
                            {
                                tcs.SetResult(result.Clone());
                            }
                            else if (root.TryGetProperty("error", out var error))
                            {
                                tcs.SetException(new Exception(error.GetRawText()));
                            }
                        }
                    }
                }
                else if (root.TryGetProperty("method", out var methodProp))
                {
                    // It's a notification (no ID)
                    string method = methodProp.GetString() ?? "";
                    root.TryGetProperty("params", out var paramsProp);
                    
                    if (method == "deeplens/progress" && paramsProp.TryGetProperty("percentage", out var percentProp))
                    {
                        IndexingProgress = percentProp.GetDouble();
                        OnIndexingProgress?.Invoke(IndexingProgress);
                        Logger.Log($"Indexing Progress: {IndexingProgress}%");
                    }
                    else if (method == "deeplens/status" && paramsProp.TryGetProperty("status", out var statusProp))
                    {
                        if (statusProp.GetString() == "indexed")
                        {
                            IndexingProgress = 100;
                            OnIndexingProgress?.Invoke(100);
                        }
                    }

                    NotificationReceived?.Invoke(method, paramsProp.Clone());
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error processing LSP message: {ex}");
            }
        }

        public async Task<T?> SendRequestAsync<T>(string method, object @params)
        {
            if (writer == null) return default;

            var id = Interlocked.Increment(ref requestId);
            var request = new
            {
                jsonrpc = "2.0",
                id = id,
                method = method,
                @params = @params
            };

            var tcs = new TaskCompletionSource<JsonElement>();
            pendingRequests[id] = tcs;

            var json = JsonSerializer.Serialize(request);
            var message = $"Content-Length: {Encoding.UTF8.GetByteCount(json)}\r\n\r\n{json}";
            
            await writer.WriteAsync(message);
            await writer.FlushAsync();

            try
            {
                var result = await tcs.Task;
                return JsonSerializer.Deserialize<T>(result.GetRawText());
            }
            catch
            {
                return default;
            }
        }

        public async Task SendNotificationAsync(string method, object @params)
        {
            if (writer == null) return;

            var notification = new
            {
                jsonrpc = "2.0",
                method = method,
                @params = @params
            };

            var json = JsonSerializer.Serialize(notification);
            var message = $"Content-Length: {Encoding.UTF8.GetByteCount(json)}\r\n\r\n{json}";
            
            await writer.WriteAsync(message);
            await writer.FlushAsync();
        }

        public async Task SendResponseAsync(JsonElement id, object? result)
        {
            if (writer == null) return;

            var response = new
            {
                jsonrpc = "2.0",
                id = id,
                result = result
            };

            var json = JsonSerializer.Serialize(response);
            var message = $"Content-Length: {Encoding.UTF8.GetByteCount(json)}\r\n\r\n{json}";
            
            await writer.WriteAsync(message);
            await writer.FlushAsync();
        }

        public void Stop()
        {
            isRunning = false;
            serverProcess?.Kill();
            serverProcess = null;
            writer = null;
            reader = null;
        }
    }
}
