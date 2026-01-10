using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Extensibility;
using Microsoft.VisualStudio.Extensibility.Commands;
using Microsoft.VisualStudio.Extensibility.Shell;
using Microsoft.VisualStudio.ProjectSystem.Query;

namespace visual_studio_extension
{
    [VisualStudioContribution]
    public class SearchCommand : Command
    {
        private readonly ExtensionEntrypoint _extension;

        public SearchCommand(ExtensionEntrypoint extension)
        {
            _extension = extension;
        }

        public override CommandConfiguration CommandConfiguration => new("%visual_studio_extension.SearchCommand.DisplayName%")
        {
            Placements = [CommandPlacement.KnownPlacements.ExtensionsMenu],
            Icon = new(ImageMoniker.KnownValues.Search, IconSettings.IconAndText),
        };

        public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
        {
            // Initialize LSP if needed
            if (_extension.LspService != null)
            {
                string rootPath = "";

                try
                {
                    // Attempt to get solution path using Project Query API
                    var solutions = await context.Extensibility.Workspaces().QuerySolutionAsync(
                        solution => solution.With(s => s.Path),
                        cancellationToken);

                    var solution = solutions.FirstOrDefault();
                    if (solution != null && !string.IsNullOrEmpty(solution.Path))
                    {
                        rootPath = Path.GetDirectoryName(solution.Path) ?? "";
                    }
                }
                catch (Exception)
                {
                    // Fallback handled below
                }

                if (string.IsNullOrEmpty(rootPath))
                {
                    // Fallback to a safe temp directory or user profile if no solution is open
                    // This prevents the "C:\" indexing disaster
                     rootPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".deeplens-fallback");
                     Directory.CreateDirectory(rootPath);
                }

                await _extension.LspService.InitializeAsync(rootPath, cancellationToken);
            }

            await _extension.Shell.ShowToolWindowAsync<SearchToolWindow>(activate: true, cancellationToken);
        }
    }

    [VisualStudioContribution]
    public class RebuildIndexCommand : Command
    {
        private readonly ExtensionEntrypoint _extension;

        public RebuildIndexCommand(ExtensionEntrypoint extension)
        {
            _extension = extension;
        }

        public override CommandConfiguration CommandConfiguration => new("%visual_studio_extension.RebuildIndexCommand.DisplayName%")
        {
            Placements = [CommandPlacement.KnownPlacements.ExtensionsMenu],
            Icon = new(ImageMoniker.KnownValues.Refresh, IconSettings.IconAndText),
        };

        public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
        {
             if (_extension.LspService != null)
            {
                await _extension.LspService.RebuildIndexAsync(true);
            }
        }
    }
}
