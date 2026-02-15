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
    /// Command to rebuild the DeepLens index.
    /// </summary>
    [VisualStudioContribution]
    internal class RebuildIndexCommand : Command
    {
        private readonly TraceSource _logger;

        public RebuildIndexCommand(TraceSource traceSource)
        {
            _logger = Requires.NotNull(traceSource);
        }

        /// <inheritdoc />
        public override CommandConfiguration CommandConfiguration =>
            new CommandConfiguration("DeepLens: Rebuild Index")
            {
                Icon = new CommandIconConfiguration(ImageMoniker.KnownValues.Refresh, IconSettings.IconAndText),
                Placements = [CommandPlacement.KnownPlacements.ExtensionsMenu],
            };

        /// <inheritdoc />
        public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
        {
            _logger.TraceEvent(TraceEventType.Information, 0, "DeepLens Rebuild Index command executed");

            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            try
            {
                var searchService = SearchControl.SharedSearchService;
                if (searchService == null)
                {
                    ShowInfoBar("DeepLens LSP service is not initialized. Please open a solution first.");
                    return;
                }

                // Subscribe to progress events
                void ProgressHandler(ProgressInfo progress)
                {
                    ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
                    {
                        await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                        
                        string message;
                        if (progress.State == "start")
                        {
                            message = "DeepLens: Rebuilding index...";
                        }
                        else if (progress.State == "end")
                        {
                            message = "DeepLens: Index rebuild complete!";
                        }
                        else
                        {
                            message = progress.Percentage.HasValue 
                                ? $"DeepLens: {progress.Message} ({progress.Percentage}%)"
                                : $"DeepLens: {progress.Message}";
                        }
                        
                        ShowInfoBarInternal(message);
                    });
                }

                searchService.OnProgress += ProgressHandler;
                
                try
                {
                    ShowInfoBar("DeepLens: Rebuilding index...");
                    await searchService.RebuildIndexAsync(force: true);
                }
                finally
                {
                    // Unsubscribe after a delay to catch the final "end" progress
                    _ = Task.Delay(5000).ContinueWith(_ => searchService.OnProgress -= ProgressHandler);
                }
            }
            catch (Exception ex)
            {
                _logger.TraceEvent(TraceEventType.Error, 0, $"Error rebuilding index: {ex.Message}");
                Debug.WriteLine($"DeepLens: Error rebuilding index: {ex.Message}");
            }
        }

        private void ShowInfoBar(string message)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            ShowInfoBarInternal(message);
        }

        private void ShowInfoBarInternal(string message)
        {
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
