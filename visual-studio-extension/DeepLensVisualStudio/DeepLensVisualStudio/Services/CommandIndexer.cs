using System;
using System.Collections.Generic;
using System.Linq;
using EnvDTE;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace DeepLensVisualStudio.Services
{
    /// <summary>
    /// Indexes Visual Studio commands for search.
    /// </summary>
    public class CommandIndexer
    {
        private List<CommandItem> _commands = new List<CommandItem>();

        public class CommandItem
        {
            public string Id { get; set; } = "";
            public string Name { get; set; } = "";
            public string Description { get; set; } = "";
        }

        /// <summary>
        /// Indexes all available Visual Studio commands.
        /// </summary>
        public async Task IndexCommandsAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

            _commands.Clear();

            try
            {
                var dte = ServiceProvider.GlobalProvider.GetService(typeof(SDTE)) as DTE;
                if (dte?.Commands == null)
                {
                    System.Diagnostics.Debug.WriteLine("DeepLens: DTE or Commands not available");
                    return;
                }

                foreach (Command cmd in dte.Commands)
                {
                    try
                    {
                        // Skip internal commands (those starting with _)
                        if (cmd.Name.StartsWith("_", StringComparison.Ordinal))
                        {
                            continue;
                        }

                        // Get command name and description
                        string commandId = cmd.Name;
                        string title = CommandIdToTitle(commandId);
                        string description = "";

                        try
                        {
                            if (cmd.Bindings is object[] bindings && bindings.Length > 0)
                            {
                                description = string.Join(", ", bindings);
                            }
                        }
                        catch { }

                        _commands.Add(new CommandItem
                        {
                            Id = commandId,
                            Name = title,
                            Description = description
                        });
                    }
                    catch
                    {
                        // Skip commands that can't be accessed
                        continue;
                    }
                }

                System.Diagnostics.Debug.WriteLine($"DeepLens: Indexed {_commands.Count} commands");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"DeepLens: Failed to index commands: {ex.Message}");
            }
        }

        /// <summary>
        /// Converts command ID to human-readable title.
        /// e.g., "Edit.FormatDocument" -> "Format Document"
        /// </summary>
        private string CommandIdToTitle(string commandId)
        {
            // Remove common prefixes case-insensitively
            string[] prefixes = { "Edit.", "File.", "View.", "Project.", "Build.", "Debug.", "Tools.", "Window.", "Help." };
            string title = commandId;
            
            foreach (var prefix in prefixes)
            {
                if (title.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    title = title.Substring(prefix.Length);
                    break;
                }
            }

            // Split by dots and capitalize
            string[] parts = title.Split('.');
            return string.Join(" ", parts.Select(part =>
            {
                // Split camelCase
                string words = System.Text.RegularExpressions.Regex.Replace(part, "([A-Z])", " $1").Trim();
                // Capitalize first letter of each word
                return string.Join(" ", words.Split(' ')
                    .Select(w => w.Length > 0 ? char.ToUpper(w[0]) + w.Substring(1).ToLower() : w));
            }));
        }

        /// <summary>
        /// Searches commands by name (simple contains match).
        /// </summary>
        public IEnumerable<CommandItem> SearchCommands(string query)
        {
            if (string.IsNullOrWhiteSpace(query))
            {
                return _commands;
            }

            query = query.ToLowerInvariant();
            return _commands.Where(cmd =>
                cmd.Name.ToLowerInvariant().Contains(query) ||
                cmd.Id.ToLowerInvariant().Contains(query) ||
                cmd.Description.ToLowerInvariant().Contains(query)
            ).Take(20);
        }

        /// <summary>
        /// Gets all indexed commands.
        /// </summary>
        public IEnumerable<CommandItem> GetCommands()
        {
            return _commands;
        }

        /// <summary>
        /// Executes a command by ID.
        /// </summary>
        public async Task ExecuteCommandAsync(string commandId)
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

            try
            {
                var dte = ServiceProvider.GlobalProvider.GetService(typeof(SDTE)) as DTE;
                if (dte != null)
                {
                    dte.ExecuteCommand(commandId);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"DeepLens: Failed to execute command {commandId}: {ex.Message}");
            }
        }
    }
}
