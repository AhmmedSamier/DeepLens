using System;

namespace DeepLensVisualStudio.Services
{
    public class SearchResult
    {
        public string Name { get; set; } = "";
        public string Kind { get; set; } = "";
        public string FilePath { get; set; } = "";
        public int Line { get; set; }
        public string ContainerName { get; set; } = "";
        public int Score { get; set; }
        public string UniqueKey => $"{FilePath}:{Line}:{Name}:{Kind}";

        public SearchResult() { }
        public SearchResult(string name, string kind, string filePath, int line, string containerName, int score = 0)
        {
            Name = name; Kind = kind; FilePath = filePath; Line = line; ContainerName = containerName; Score = score;
        }
    }

    public class SearchTimings
    {
        public long FirstResultMs { get; set; }
        public long TotalMs { get; set; }
    }

    public class IndexStats
    {
        public int TotalItems { get; set; }
        public int TotalFiles { get; set; }
        public int TotalSymbols { get; set; }
        public long CacheSize { get; set; }
    }

    public class ProgressInfo
    {
        public string State { get; set; } = ""; // "start", "report", "end"
        public string? Message { get; set; }
        public int? Percentage { get; set; }
    }
}
