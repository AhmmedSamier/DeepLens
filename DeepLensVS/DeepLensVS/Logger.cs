using System;
using System.IO;

namespace DeepLensVS
{
    public static class Logger
    {
        private static string LogPath = @"d:\source-code\finder\DeepLensVS\deeplens_debug.log";

        static Logger()
        {
            // Reset log on start
            try { File.WriteAllText(LogPath, $"--- Log Start {DateTime.Now} ---{Environment.NewLine}"); } catch {}
        }

        public static void Log(string message)
        {
            try
            {
                File.AppendAllText(LogPath, $"{DateTime.Now:HH:mm:ss.fff} [{System.Threading.Thread.CurrentThread.ManagedThreadId}] {message}{Environment.NewLine}");
            }
            catch { }
        }
        
        public static void LogError(string message, Exception ex)
        {
             Log($"ERROR: {message} - {ex.Message}\n{ex.StackTrace}");
        }
    }
}
