using System;
using System.Collections.Generic;
using System.Linq;

namespace DeepLensVisualStudio.Services
{
    public enum SlashCommandCategory
    {
        Search,
        Navigation,
        Files,
        Refactoring,
        Actions
    }

    public class SlashCommand
    {
        public string Name { get; set; } = "";
        public string ShortName { get; set; } = "";
        public string Description { get; set; } = "";
        public string[] Aliases { get; set; } = Array.Empty<string>();
        public SlashCommandCategory Category { get; set; }
        public string Icon { get; set; } = "";
        public string KeyboardShortcut { get; set; } = "";
        public string Example { get; set; } = "";
    }

    public class SlashCommandService
    {
        private readonly List<SlashCommand> _commands;
        private readonly Dictionary<SlashCommandCategory, List<SlashCommand>> _categoryGroups;
        private readonly List<string> _recentlyUsed;

        public SlashCommandService()
        {
            _commands = new List<SlashCommand>
            {
                new SlashCommand 
                { 
                    Name = "/all", 
                    ShortName = "all",
                    Description = "Search everywhere across all scopes",
                    Aliases = new[] { "/a" },
                    Category = SlashCommandCategory.Search,
                    Icon = "search",
                    KeyboardShortcut = "Ctrl+T",
                    Example = "/all UserService"
                },
                new SlashCommand 
                { 
                    Name = "/t", 
                    ShortName = "t",
                    Description = "Find classes, interfaces, and types",
                    Aliases = new[] { "/classes", "/types", "/type", "/c" },
                    Category = SlashCommandCategory.Search,
                    Icon = "symbol-class",
                    KeyboardShortcut = "Ctrl+Shift+T",
                    Example = "/t User"
                },
                new SlashCommand 
                { 
                    Name = "/s", 
                    ShortName = "s",
                    Description = "Find methods, functions, and variables",
                    Aliases = new[] { "/symbols", "/symbol", "#" },
                    Category = SlashCommandCategory.Search,
                    Icon = "symbol-method",
                    KeyboardShortcut = "Ctrl+Shift+O",
                    Example = "/s getUsers"
                },
                new SlashCommand 
                { 
                    Name = "/f", 
                    ShortName = "f",
                    Description = "Find files by name or path",
                    Aliases = new[] { "/files", "/file" },
                    Category = SlashCommandCategory.Files,
                    Icon = "file",
                    KeyboardShortcut = "Ctrl+Shift+F",
                    Example = "/f UserService.cs"
                },
                new SlashCommand 
                { 
                    Name = "/txt", 
                    ShortName = "txt",
                    Description = "Search text content across files",
                    Aliases = new[] { "/text", "/find", "/grep" },
                    Category = SlashCommandCategory.Search,
                    Icon = "whole-word",
                    KeyboardShortcut = "Ctrl+Shift+G",
                    Example = "/txt \"async function\""
                },
                new SlashCommand 
                { 
                    Name = "/e", 
                    ShortName = "e",
                    Description = "Find API endpoints and routes",
                    Aliases = new[] { "/endpoints", "/endpoint", "/routes", "/api" },
                    Category = SlashCommandCategory.Search,
                    Icon = "globe",
                    Example = "/e /api/users"
                },
                new SlashCommand 
                { 
                    Name = "/o", 
                    ShortName = "o",
                    Description = "Search in currently open files",
                    Aliases = new[] { "/open", "/opened" },
                    Category = SlashCommandCategory.Navigation,
                    Icon = "book",
                    Example = "/o search"
                },
                new SlashCommand 
                { 
                    Name = "/m", 
                    ShortName = "m",
                    Description = "Search in modified or untracked files",
                    Aliases = new[] { "/modified", "/mod", "/git", "/changed" },
                    Category = SlashCommandCategory.Files,
                    Icon = "git-merge",
                    Example = "/m service"
                },
                new SlashCommand 
                { 
                    Name = "/p", 
                    ShortName = "p",
                    Description = "Find properties and fields",
                    Aliases = new[] { "/properties", "/prop", "/field" },
                    Category = SlashCommandCategory.Search,
                    Icon = "symbol-property",
                    Example = "/p userId"
                },
                new SlashCommand 
                { 
                    Name = "/cmd", 
                    ShortName = "cmd",
                    Description = "Search and execute VS commands",
                    Aliases = new[] { "/commands", "/action", "/run", ">" },
                    Category = SlashCommandCategory.Actions,
                    Icon = "run",
                    KeyboardShortcut = "Ctrl+Shift+P",
                    Example = "/cmd \"format document\""
                },
            };

            _categoryGroups = _commands
                .GroupBy(c => c.Category)
                .ToDictionary(g => g.Key, g => g.ToList());

            _recentlyUsed = LoadRecentCommands();
        }

        public IEnumerable<SlashCommand> GetCommands(string query = "")
        {
            if (string.IsNullOrEmpty(query))
                return _commands;

            string lowerQuery = query.ToLowerInvariant();
            var results = new List<SlashCommand>();
            var seen = new HashSet<string>();

            foreach (var cmd in _commands)
            {
                if (seen.Contains(cmd.Name)) continue;

                bool exactMatch = cmd.Name.Equals(lowerQuery, StringComparison.OrdinalIgnoreCase);
                bool startsWithMatch = cmd.Name.StartsWith(lowerQuery, StringComparison.OrdinalIgnoreCase);
                bool aliasMatch = cmd.Aliases.Any(a => 
                    a.Equals(lowerQuery, StringComparison.OrdinalIgnoreCase) || 
                    a.StartsWith(lowerQuery, StringComparison.OrdinalIgnoreCase));
                bool descriptionMatch = cmd.Description.IndexOf(lowerQuery, StringComparison.OrdinalIgnoreCase) >= 0;
                bool shortNameMatch = cmd.ShortName.StartsWith(lowerQuery, StringComparison.OrdinalIgnoreCase);

                if (exactMatch || startsWithMatch || aliasMatch || descriptionMatch || shortNameMatch)
                {
                    results.Add(cmd);
                    seen.Add(cmd.Name);
                }
            }

            SortResults(results, lowerQuery);
            return results;
        }

        public IEnumerable<SlashCommand> GetRecentCommands()
        {
            var recent = new List<SlashCommand>();
            var seen = new HashSet<string>();

            foreach (var name in _recentlyUsed)
            {
                var cmd = _commands.FirstOrDefault(c => 
                    c.Name.Equals(name, StringComparison.OrdinalIgnoreCase) ||
                    c.Aliases.Any(a => a.Equals(name, StringComparison.OrdinalIgnoreCase)));
                
                if (cmd != null && !seen.Contains(cmd.Name))
                {
                    recent.Add(cmd);
                    seen.Add(cmd.Name);
                }
            }

            return recent;
        }

        public IEnumerable<SlashCommand> GetCommandsByCategory(SlashCommandCategory category)
        {
            return _categoryGroups.ContainsKey(category) 
                ? _categoryGroups[category] 
                : Enumerable.Empty<SlashCommand>();
        }

        public IEnumerable<SlashCommandCategory> GetAllCategories()
        {
            return _categoryGroups.Keys;
        }

        public SlashCommand GetCommand(string commandOrAlias)
        {
            string normalized = commandOrAlias.ToLowerInvariant();
            return _commands.FirstOrDefault(c => 
                c.Name.Equals(normalized, StringComparison.OrdinalIgnoreCase) ||
                c.Aliases.Any(a => a.Equals(normalized, StringComparison.OrdinalIgnoreCase)));
        }

        public string GetPrimaryAlias(SlashCommand cmd)
        {
            return cmd.Aliases.Length > 0 ? cmd.Aliases[0] : cmd.Name;
        }

        public void RecordUsage(string commandName)
        {
            string normalized = commandName.ToLowerInvariant();
            _recentlyUsed.RemoveAll(c => c.Equals(normalized, StringComparison.OrdinalIgnoreCase));
            _recentlyUsed.Insert(0, normalized);
            
            if (_recentlyUsed.Count > 10)
                _recentlyUsed.RemoveAt(_recentlyUsed.Count - 1);

            SaveRecentCommands();
        }

        private void SortResults(List<SlashCommand> results, string query)
        {
            string lowerQuery = query.ToLowerInvariant();

            results.Sort((a, b) =>
            {
                bool aExact = a.Name.Equals(lowerQuery, StringComparison.OrdinalIgnoreCase);
                bool bExact = b.Name.Equals(lowerQuery, StringComparison.OrdinalIgnoreCase);

                if (aExact && !bExact) return -1;
                if (!aExact && bExact) return 1;

                bool aRecent = _recentlyUsed.Any(r => 
                    r.Equals(a.Name, StringComparison.OrdinalIgnoreCase) ||
                    a.Aliases.Any(ali => ali.Equals(r, StringComparison.OrdinalIgnoreCase)));
                bool bRecent = _recentlyUsed.Any(r => 
                    r.Equals(b.Name, StringComparison.OrdinalIgnoreCase) ||
                    b.Aliases.Any(ali => ali.Equals(r, StringComparison.OrdinalIgnoreCase)));

                if (aRecent && !bRecent) return -1;
                if (!aRecent && bRecent) return 1;

                bool aStartsWith = a.Name.StartsWith(lowerQuery, StringComparison.OrdinalIgnoreCase);
                bool bStartsWith = b.Name.StartsWith(lowerQuery, StringComparison.OrdinalIgnoreCase);

                if (aStartsWith && !bStartsWith) return -1;
                if (!aStartsWith && bStartsWith) return 1;

                return string.Compare(a.Name, b.Name, StringComparison.Ordinal);
            });
        }

        private List<string> LoadRecentCommands()
        {
            try
            {
                var settings = Microsoft.VisualStudio.Shell.Package.GetGlobalService(typeof(Microsoft.VisualStudio.Shell.Interop.SVsSettingsManager)) 
                    as Microsoft.VisualStudio.Shell.Interop.IVsSettingsManager;
                
                // This would need proper settings storage implementation
                // For now, return empty list
                return new List<string>();
            }
            catch
            {
                return new List<string>();
            }
        }

        private void SaveRecentCommands()
        {
            try
            {
                // This would need proper settings storage implementation
            }
            catch
            {
                // Ignore save errors
            }
        }

        public string FormatCommandForDisplay(SlashCommand cmd)
        {
            string shortcuts = !string.IsNullOrEmpty(cmd.KeyboardShortcut) ? $" [{cmd.KeyboardShortcut}]" : "";
            return $"{GetPrimaryAlias(cmd)}: {cmd.Description}{shortcuts}";
        }

        public string GetCategoryLabel(SlashCommandCategory category)
        {
            switch (category)
            {
                case SlashCommandCategory.Search: return "Search";
                case SlashCommandCategory.Navigation: return "Navigation";
                case SlashCommandCategory.Files: return "Files";
                case SlashCommandCategory.Refactoring: return "Refactoring";
                case SlashCommandCategory.Actions: return "Actions";
                default: return category.ToString();
            }
        }
    }
}
