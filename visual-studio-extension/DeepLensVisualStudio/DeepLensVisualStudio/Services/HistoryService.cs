using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;

namespace DeepLensVisualStudio.Services
{
    public class HistoryItem
    {
        public string Name { get; set; } = "";
        public string Kind { get; set; } = "";
        public string FilePath { get; set; } = "";
        public string RelativePath { get; set; } = "";
        public int Line { get; set; }
        public string ContainerName { get; set; } = "";
        public DateTime LastAccessed { get; set; }
    }

    public class HistoryService
    {
        private readonly string _storagePath;
        private List<HistoryItem> _history = new List<HistoryItem>();
        private const int MaxHistoryItems = 20;

        public HistoryService()
        {
            try
            {
                var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                var deepLensDir = Path.Combine(appData, "DeepLens");
                if (!Directory.Exists(deepLensDir))
                {
                    Directory.CreateDirectory(deepLensDir);
                }
                _storagePath = Path.Combine(deepLensDir, "history.json");
                Load();
            }
            catch
            {
                // Fallback if we can't access AppData
                _storagePath = "";
            }
        }

        public void AddItem(HistoryItem item)
        {
            if (item == null) return;
            if (item.Kind == "Command") return;

            try
            {
                // Remove existing item if same file
                _history.RemoveAll(x => x.FilePath == item.FilePath);

                item.LastAccessed = DateTime.Now;
                _history.Insert(0, item);

                if (_history.Count > MaxHistoryItems)
                {
                    _history = _history.Take(MaxHistoryItems).ToList();
                }

                Save();
            }
            catch { }
        }

        public IEnumerable<HistoryItem> GetHistory()
        {
            return _history;
        }

        private void Save()
        {
            if (string.IsNullOrEmpty(_storagePath)) return;
            try
            {
                var json = JsonConvert.SerializeObject(_history, Formatting.Indented);
                File.WriteAllText(_storagePath, json);
            }
            catch (Exception)
            {
                // Ignore save errors
            }
        }

        private void Load()
        {
            if (string.IsNullOrEmpty(_storagePath)) return;
            try
            {
                if (File.Exists(_storagePath))
                {
                    var json = File.ReadAllText(_storagePath);
                    _history = JsonConvert.DeserializeObject<List<HistoryItem>>(json) ?? new List<HistoryItem>();
                }
            }
            catch (Exception)
            {
                _history = new List<HistoryItem>();
            }
        }
    }
}
