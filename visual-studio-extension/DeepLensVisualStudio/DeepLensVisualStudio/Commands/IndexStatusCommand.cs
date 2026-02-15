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
    /// Command to show DeepLens index statistics and actions.
    /// </summary>
    [VisualStudioContribution]
    internal class IndexStatusCommand : Command
    {
        private readonly TraceSource _logger;

        public IndexStatusCommand(TraceSource traceSource)
        {
            _logger = Requires.NotNull(traceSource);
        }

        /// <inheritdoc />
        public override CommandConfiguration CommandConfiguration =>
            new CommandConfiguration("DeepLens: Index Status")
            {
                Icon = new CommandIconConfiguration(ImageMoniker.KnownValues.Database, IconSettings.IconAndText),
                Placements = [CommandPlacement.KnownPlacements.ExtensionsMenu],
            };

        /// <inheritdoc />
        public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
        {
            _logger.TraceEvent(TraceEventType.Information, 0, "DeepLens Index Status command executed");

            await ShowIndexStatusAsync(cancellationToken);
        }

        private async Task ShowIndexStatusAsync(CancellationToken cancellationToken)
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            try
            {
                // Get the shared LSP service from SearchControl
                var searchService = SearchControl.SharedSearchService;
                if (searchService == null)
                {
                    ShowInfoBar("DeepLens LSP service is not initialized. Please open a solution and use DeepLens Search first.");
                    return;
                }

                // Get index stats
                var stats = await searchService.GetIndexStatsAsync();
                
                // Build status message
                string statusMessage;
                if (stats != null)
                {
                    var sizeInMB = (stats.CacheSize / (1024.0 * 1024.0)).ToString("F2");
                    statusMessage = $"DeepLens Index Status\n\n" +
                                    $"📊 {stats.TotalItems} items indexed\n" +
                                    $"   • {stats.TotalFiles} files\n" +
                                    $"   • {stats.TotalSymbols} symbols\n" +
                                    $"   • {sizeInMB} MB cache size";
                }
                else
                {
                    statusMessage = "DeepLens Index Status\n\n📊 Index status not available";
                }

                // Show options dialog with custom buttons
                var dialog = new System.Windows.Window
                {
                    Title = "DeepLens Index Statistics & Actions",
                    Width = 400,
                    Height = 300,
                    WindowStartupLocation = System.Windows.WindowStartupLocation.CenterOwner,
                    ResizeMode = System.Windows.ResizeMode.NoResize
                };

                var stackPanel = new System.Windows.Controls.StackPanel
                {
                    Margin = new System.Windows.Thickness(20)
                };

                var textBlock = new System.Windows.Controls.TextBlock
                {
                    Text = statusMessage,
                    Margin = new System.Windows.Thickness(0, 0, 0, 20),
                    TextWrapping = System.Windows.TextWrapping.Wrap
                };
                stackPanel.Children.Add(textBlock);

                var rebuildButton = new System.Windows.Controls.Button
                {
                    Content = "Rebuild Index",
                    Margin = new System.Windows.Thickness(0, 0, 0, 10),
                    Padding = new System.Windows.Thickness(10, 5, 10, 5)
                };
                rebuildButton.Click += async (s, e) =>
                {
                    dialog.DialogResult = true;
                    dialog.Close();
                    await RebuildIndexAsync(searchService);
                };
                stackPanel.Children.Add(rebuildButton);

                var clearCacheButton = new System.Windows.Controls.Button
                {
                    Content = "Clear Cache",
                    Margin = new System.Windows.Thickness(0, 0, 0, 10),
                    Padding = new System.Windows.Thickness(10, 5, 10, 5)
                };
                clearCacheButton.Click += async (s, e) =>
                {
                    dialog.DialogResult = true;
                    dialog.Close();
                    await ClearCacheAsync(searchService);
                };
                stackPanel.Children.Add(clearCacheButton);

                var settingsButton = new System.Windows.Controls.Button
                {
                    Content = "Open Settings",
                    Margin = new System.Windows.Thickness(0, 0, 0, 10),
                    Padding = new System.Windows.Thickness(10, 5, 10, 5)
                };
                settingsButton.Click += (s, e) =>
                {
                    dialog.DialogResult = true;
                    dialog.Close();
                    OpenSettings();
                };
                stackPanel.Children.Add(settingsButton);

                var cancelButton = new System.Windows.Controls.Button
                {
                    Content = "Close",
                    Padding = new System.Windows.Thickness(10, 5, 10, 5)
                };
                cancelButton.Click += (s, e) =>
                {
                    dialog.DialogResult = false;
                    dialog.Close();
                };
                stackPanel.Children.Add(cancelButton);

                dialog.Content = stackPanel;
                dialog.ShowDialog();
            }
            catch (Exception ex)
            {
                _logger.TraceEvent(TraceEventType.Error, 0, $"Error showing index status: {ex.Message}");
                Debug.WriteLine($"DeepLens: Error showing index status: {ex.Message}");
            }
        }

        private async Task RebuildIndexAsync(LspSearchService searchService)
        {
            // Subscribe to progress events
            void ProgressHandler(ProgressInfo progress)
            {
                ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
                {
                    await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                    
                    string message;
                    if (progress.State == "start")
                    {
                        message = "DeepLens: Indexing...";
                    }
                    else if (progress.State == "end")
                    {
                        message = "DeepLens: Indexing complete!";
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

        private async Task ClearCacheAsync(LspSearchService searchService)
        {
            await searchService.ClearCacheAsync();
            ShowInfoBar("DeepLens: Index cache cleared.");
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

        private void OpenSettings()
        {
            try
            {
                ThreadHelper.ThrowIfNotOnUIThread();
                var dte = Package.GetGlobalService(typeof(SDTE)) as EnvDTE.DTE;
                if (dte != null)
                {
                    dte.ExecuteCommand("Tools.Options", "DeepLens\\General");
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Error opening settings: {ex.Message}");
            }
        }
    }
}
