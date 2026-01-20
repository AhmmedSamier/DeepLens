using System;
using System.Collections.Generic;
using System.Linq;

namespace DeepLensVisualStudio.Services
{
    public class SlashCommand
    {
        public string Name { get; set; } = "";
        public string Description { get; set; } = "";
        public string[] Aliases { get; set; } = Array.Empty<string>();
    }

    public class SlashCommandService
    {
        private readonly List<SlashCommand> _commands;

        public SlashCommandService()
        {
            _commands = new List<SlashCommand>
            {
                 new SlashCommand { Name = "/all", Description = "Search Everything", Aliases = new[] { "/a" } },
                 new SlashCommand { Name = "/classes", Description = "Search Classes", Aliases = new[] { "/types", "/t" } },
                 new SlashCommand { Name = "/symbols", Description = "Search Symbols", Aliases = new[] { "/s" } },
                 new SlashCommand { Name = "/files", Description = "Search Files", Aliases = new[] { "/f" } },
                 new SlashCommand { Name = "/text", Description = "Search Text", Aliases = new[] { "/txt" } },
                 new SlashCommand { Name = "/endpoints", Description = "Search Endpoints", Aliases = new[] { "/e" } }
            };
        }

        public IEnumerable<SlashCommand> GetCommands(string query)
        {
            if (string.IsNullOrEmpty(query)) return Enumerable.Empty<SlashCommand>();

            string lowerQuery = query.ToLowerInvariant();
            var results = new List<SlashCommand>();

            foreach (var cmd in _commands)
            {
                bool match = cmd.Name.StartsWith(lowerQuery);
                if (!match && cmd.Aliases != null)
                {
                    foreach (var alias in cmd.Aliases)
                    {
                        if (alias.StartsWith(lowerQuery))
                        {
                            match = true;
                            break;
                        }
                    }
                }

                if (match)
                {
                    results.Add(cmd);
                }
            }
            return results;
        }
    }
}
