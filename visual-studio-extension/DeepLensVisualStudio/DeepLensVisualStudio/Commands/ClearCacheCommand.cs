using System.Diagnostics;
using DeepLensVisualStudio.Services;
using DeepLensVisualStudio.ToolWindows;
using Microsoft;
using Microsoft.VisualStudio.Extensibility;
using Microsoft.VisualStudio.Extensibility.Commands;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;

namespace DeepLensVisualStudio.Commands
{
    /// <summary>
    /// Command to clear the DeepLens index cache.
    /// </summary>
    [VisualStudioContribution]
    internal class ClearCacheCommand : Command
    {
        private readonly TraceSource _logger;

        public ClearCacheCommand(TraceSource traceSource)
        {
            _logger = Requires.NotNull(traceSource);
        }

        /// <inheritdoc />
        public override CommandConfiguration CommandConfiguration =>
            new CommandConfiguration("DeepLens: Clear Index Cache")
            {
                Icon = new CommandIconConfiguration(ImageMoniker.KnownValues.Delete, IconSettings.IconAndText),
                Placements = [CommandPlacement.KnownPlacements.ExtensionsMenu],
            };

        /// <inheritdoc />
        public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
        {
            _logger.TraceEvent(TraceEventType.Information, 0, "DeepLens Clear Cache command executed");

            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            try
            {
                var searchService = SearchControl.SharedSearchService;
                if (searchService == null)
                {
                    ShowInfoBar("DeepLens LSP service is not initialized. Please open a solution first.");
                    return;
                }

                await searchService.ClearCacheAsync();
                ShowInfoBar("DeepLens: Index cache cleared.");
            }
            catch (Exception ex)
            {
                _logger.TraceEvent(TraceEventType.Error, 0, $"Error clearing cache: {ex.Message}");
                Debug.WriteLine($"DeepLens: Error clearing cache: {ex.Message}");
            }
        }

        private void ShowInfoBar(string message)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                var statusBar = Package.GetGlobalService(typeof(SVsStatusbar)) as IVsStatusbar;
                statusBar?.SetText(message);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Error showing status bar message: {ex.Message}");
            }
        }
    }
}
