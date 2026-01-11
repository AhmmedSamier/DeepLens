using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Diagnostics;

namespace DeepLensVS
{
    public static class LspManager
    {
        private static LspClient? client;
        private static bool initializing = false;

        public static LspClient Client
        {
            get
            {
                if (client == null)
                {
                    client = new LspClient();
                }
                return client;
            }
        }

        public static async Task EnsureStartedAsync(string? rootUri = null)
        {
            if (initializing) return;
            if (client != null && client.IsRunning) return;

            initializing = true;
            try
            {
                var extensionDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                // Try to find the LSP exe in the dist folder (relative to extension dir or bundled)
                // For dev, it might be in the vscode-extension/dist folder
                var lspExe = Path.Combine(extensionDir!, "deeplens-lsp.exe");
                
                if (!File.Exists(lspExe))
                {
                    // Fallback for dev environment based on known structure
                    lspExe = @"d:\source-code\finder\vscode-extension\dist\deeplens-lsp.exe";
                }

                if (File.Exists(lspExe))
                {
                    // Log files in directory to verify WASM presence
                    try
                    {
                        var files = Directory.GetFiles(extensionDir!);
                        Logger.Log($"Files in extension dir ({extensionDir}):");
                        foreach (var f in files)
                        {
                            Logger.Log($" - {Path.GetFileName(f)}");
                        }
                    }
                    catch (Exception ex)
                    {
                        Logger.LogError("Failed to list directory", ex);
                    }
                    var storagePath = Path.Combine(
                        System.Environment.GetFolderPath(System.Environment.SpecialFolder.ApplicationData),
                        "DeepLensVS");
                    
                    if (!Directory.Exists(storagePath)) Directory.CreateDirectory(storagePath);

                    Logger.Log($"Starting LSP client. Exe: {lspExe}, Root: {rootUri ?? "null"}");
                    await Client.StartAsync(lspExe, "--stdio", new { 
                        storagePath = storagePath,
                        extensionPath = extensionDir
                    }, rootUri);
                }
                else
                {
                    Logger.Log($"LSP Executable not found at {lspExe}");
                    Debug.WriteLine("LSP Executable not found!");
                }
            }
            finally
            {
                initializing = false;
            }
        }
    }
}
