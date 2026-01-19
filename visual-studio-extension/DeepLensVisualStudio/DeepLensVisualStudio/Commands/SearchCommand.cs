using System.Diagnostics;
using System.Runtime.InteropServices;
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
        private static IntPtr _mouseHookId = IntPtr.Zero;
        private static LowLevelMouseProc? _mouseProc;

        // Win32 constants
        private const int WH_MOUSE_LL = 14;
        private const int WM_LBUTTONDOWN = 0x0201;
        private const int WM_RBUTTONDOWN = 0x0204;
        private const int WM_MBUTTONDOWN = 0x0207;

        private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MSLLHOOKSTRUCT
        {
            public POINT pt;
            public uint mouseData;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        /// <summary>
        /// Initializes a new instance of the <see cref="SearchCommand"/> class.
        /// </summary>
        public SearchCommand(TraceSource traceSource)
        {
            _logger = Requires.NotNull(traceSource);
        }

        /// <inheritdoc />
        public override CommandConfiguration CommandConfiguration =>
            new CommandConfiguration("DeepLens: Search Everywhere")
            {
                Icon = new CommandIconConfiguration(ImageMoniker.KnownValues.Search, IconSettings.IconAndText),
                Placements = [CommandPlacement.KnownPlacements.ExtensionsMenu],
                Shortcuts = [new CommandShortcutConfiguration(ModifierKey.ControlShift, Microsoft.VisualStudio.Extensibility.Commands.Key.S)],
            };

        /// <inheritdoc />
        public override async Task ExecuteCommandAsync(IClientContext context, CancellationToken cancellationToken)
        {
            _logger.TraceEvent(TraceEventType.Information, 0, "DeepLens Search command executed");

            // Show search window
            await ShowSearchWindowAsync(cancellationToken);
        }

        private static void InstallMouseHook()
        {
            if (_mouseHookId != IntPtr.Zero)
                return;

            _mouseProc = MouseHookCallback;
            using var curProcess = Process.GetCurrentProcess();
            using var curModule = curProcess.MainModule;

            if (curModule != null)
            {
                _mouseHookId = SetWindowsHookEx(WH_MOUSE_LL, _mouseProc, GetModuleHandle(curModule.ModuleName), 0);
            }
        }

        private static void UninstallMouseHook()
        {
            if (_mouseHookId != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_mouseHookId);
                _mouseHookId = IntPtr.Zero;
            }
        }

        private static IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && _searchWindow != null && _searchWindow.IsVisible)
            {
                int msg = (int)wParam;
                if (msg == WM_LBUTTONDOWN || msg == WM_RBUTTONDOWN || msg == WM_MBUTTONDOWN)
                {
                    var hookStruct = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
                    var clickPoint = new System.Windows.Point(hookStruct.pt.x, hookStruct.pt.y);

                    // Check if click is outside the search window
                    Microsoft.VisualStudio.Shell.ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
                    {
                        await Microsoft.VisualStudio.Shell.ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                        
                        if (_searchWindow != null && _searchWindow.IsVisible)
                        {
                            var windowRect = new Rect(
                                _searchWindow.Left, 
                                _searchWindow.Top, 
                                _searchWindow.ActualWidth, 
                                _searchWindow.ActualHeight);

                            if (!windowRect.Contains(clickPoint))
                            {
                                _searchWindow.Close();
                            }
                        }
                    });
                }
            }

            return CallNextHookEx(_mouseHookId, nCode, wParam, lParam);
        }

        private async Task ShowSearchWindowAsync(CancellationToken cancellationToken)
        {
            await Microsoft.VisualStudio.Shell.ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync(
                cancellationToken);

            try
            {
                // If window exists and is visible, close it (toggle behavior)
                if (_searchWindow != null && _searchWindow.IsVisible)
                {
                    _searchWindow.Close();
                    return;
                }

                // Create new search window
                var searchControl = new SearchControl();

                _searchWindow = new Window
                {
                    Title = "DeepLens Search",
                    Width = 600,
                    Height = 450,
                    WindowStartupLocation = WindowStartupLocation.CenterScreen,
                    ShowInTaskbar = false,
                    WindowStyle = WindowStyle.None,
                    ResizeMode = ResizeMode.NoResize,
                    Topmost = true,
                    AllowsTransparency = true,
                    Background = new System.Windows.Media.SolidColorBrush(
                        System.Windows.Media.Color.FromArgb(1, 0, 0, 0))
                };

                // Create the visual container
                var border = new System.Windows.Controls.Border
                {
                    Background = System.Windows.Media.Brushes.White,
                    BorderBrush = new System.Windows.Media.SolidColorBrush(
                        System.Windows.Media.Color.FromRgb(80, 80, 80)),
                    BorderThickness = new Thickness(1),
                    CornerRadius = new CornerRadius(8),
                    Child = searchControl,
                    Effect = new System.Windows.Media.Effects.DropShadowEffect
                    {
                        BlurRadius = 20,
                        ShadowDepth = 5,
                        Opacity = 0.3
                    }
                };
                _searchWindow.Content = border;

                // Handle Escape to close
                _searchWindow.PreviewKeyDown += (s, e) =>
                {
                    if (e.Key == System.Windows.Input.Key.Escape)
                    {
                        _searchWindow?.Close();
                        e.Handled = true;
                    }
                };

                // Clean up reference when closed
                _searchWindow.Closed += (s, e) =>
                {
                    UninstallMouseHook();
                    _searchWindow = null;
                };

                // Install mouse hook
                InstallMouseHook();

                _searchWindow.Show();
                _searchWindow.Activate();
                _searchWindow.Focus();
                searchControl.Focus();
                System.Windows.Input.Keyboard.Focus(searchControl);
            }
            catch (Exception ex)
            {
                _logger.TraceEvent(TraceEventType.Error, 0, $"Error showing search window: {ex.Message}");
                UninstallMouseHook();
                await this.Extensibility.Shell().ShowPromptAsync(
                    $"Error opening search: {ex.Message}",
                    PromptOptions.OK,
                    cancellationToken);
            }
        }
    }
}
