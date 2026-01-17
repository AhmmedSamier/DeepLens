using System.Diagnostics;
using System.Windows;
using DeepLensVisualStudio.ToolWindows;
using Microsoft;
using Microsoft.VisualStudio.Extensibility;
using Microsoft.VisualStudio.Extensibility.Commands;
using Microsoft.VisualStudio.Extensibility.Shell;

namespace DeepLensVisualStudio.Commands
{
    /// <summary>
    /// Command to open the DeepLens Search window.
    /// </summary>
    [VisualStudioContribution]
    internal class SearchCommand : Command
    {
        private readonly TraceSource _logger;
        private static Window? _searchWindow;

        /// <summary>
        /// Initializes a new instance of the <see cref="SearchCommand"/> class.
        /// </summary>
        public SearchCommand(TraceSource traceSource)
        {
            _logger = Requires.NotNull(traceSource, nameof(traceSource));
        }

        /// <inheritdoc />
        public override CommandConfiguration CommandConfiguration =>
            new CommandConfiguration("%DeepLensVisualStudio.SearchCommand.DisplayName%")
            {
                Icon = new CommandIconConfiguration(ImageMoniker.KnownValues.Search, IconSettings.IconAndText),
                Placements = new CommandPlacement[] { CommandPlacement.KnownPlacements.ExtensionsMenu },
                Shortcuts = new CommandShortcutConfiguration[]
                    { new CommandShortcutConfiguration(ModifierKey.ControlShift, Key.S) },
            };

        /// <inheritdoc />
        public override Task InitializeAsync(CancellationToken cancellationToken)
        {
            return base.InitializeAsync(cancellationToken);
        }

        /// <inheritdoc />
        public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
        {
            _logger.TraceEvent(TraceEventType.Information, 0, "DeepLens Search command executed");

            // Show search window
            await ShowSearchWindowAsync(cancellationToken);
        }

        private async Task ShowSearchWindowAsync(CancellationToken cancellationToken)
        {
            await Microsoft.VisualStudio.Shell.ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(
                cancellationToken);

            try
            {
                // If window exists and is visible, just focus it
                if (_searchWindow != null && _searchWindow.IsVisible)
                {
                    _searchWindow.Activate();
                    return;
                }

                // Create new search window
                var searchControl = new SearchControl();

                _searchWindow = new Window
                {
                    Title = "DeepLens Search",
                    Content = searchControl,
                    Width = 600,
                    Height = 450,
                    WindowStartupLocation = WindowStartupLocation.CenterScreen,
                    ShowInTaskbar = false,
                    WindowStyle = WindowStyle.ToolWindow,
                    ResizeMode = ResizeMode.CanResizeWithGrip
                };

                // Handle Escape to close
                _searchWindow.PreviewKeyDown += (s, e) =>
                {
                    if (e.Key == System.Windows.Input.Key.Escape)
                    {
                        _searchWindow.Close();
                        e.Handled = true;
                    }
                };

                // Clean up reference when closed
                _searchWindow.Closed += (s, e) => _searchWindow = null;

                _searchWindow.Show();
                _searchWindow.Activate();
            }
            catch (Exception ex)
            {
                _logger.TraceEvent(TraceEventType.Error, 0, $"Error showing search window: {ex.Message}");
                await this.Extensibility.Shell().ShowPromptAsync(
                    $"Error opening search: {ex.Message}",
                    PromptOptions.OK,
                    cancellationToken);
            }
        }
    }
}
