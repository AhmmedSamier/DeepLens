using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using DeepLensVisualStudio.ToolWindows;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.VisualStudio.Extensibility;

namespace DeepLensVisualStudio
{
    /// <summary>
    /// Extension entrypoint for the VisualStudio.Extensibility extension.
    /// </summary>
    [VisualStudioContribution]
    internal class ExtensionEntrypoint : Extension
    {
        private static IntPtr _keyboardHookId = IntPtr.Zero;
        private static IntPtr _mouseHookId = IntPtr.Zero;
        private static LowLevelKeyboardProc? _keyboardProc;
        private static LowLevelMouseProc? _mouseProc;
        private static DateTime _lastShiftPressTime = DateTime.MinValue;
        private static bool _wasShiftPressed = false;
        private const int DoubleShiftThresholdMs = 400;
        private static Window? _searchWindow;

        // Win32 constants
        private const int WH_KEYBOARD_LL = 13;
        private const int WH_MOUSE_LL = 14;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int WM_LBUTTONDOWN = 0x0201;
        private const int WM_RBUTTONDOWN = 0x0204;
        private const int WM_MBUTTONDOWN = 0x0207;
        private const int VK_SHIFT = 0x10;
        private const int VK_LSHIFT = 0xA0;
        private const int VK_RSHIFT = 0xA1;

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
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
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        /// <inheritdoc />
        public override ExtensionConfiguration ExtensionConfiguration => new()
        {
            RequiresInProcessHosting = true,
        };

        /// <inheritdoc />
        protected override void InitializeServices(IServiceCollection serviceCollection)
        {
            base.InitializeServices(serviceCollection);

            // Install keyboard hook on the UI thread
            Microsoft.VisualStudio.Shell.ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await Microsoft.VisualStudio.Shell.ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                InstallKeyboardHook();
                Debug.WriteLine("DeepLens: Double-shift keyboard hook installed at extension initialization");
            });
        }

        protected override void Dispose(bool isDisposing)
        {
            if (isDisposing)
            {
                UninstallKeyboardHook();
                UninstallMouseHook();
            }

            base.Dispose(isDisposing);
        }

        private static void InstallKeyboardHook()
        {
            if (_keyboardHookId != IntPtr.Zero)
                return;

            _keyboardProc = KeyboardHookCallback;
            using var curProcess = Process.GetCurrentProcess();
            using var curModule = curProcess.MainModule;

            if (curModule != null)
            {
                _keyboardHookId = SetWindowsHookEx(WH_KEYBOARD_LL, _keyboardProc, GetModuleHandle(curModule.ModuleName), 0);
                Debug.WriteLine($"DeepLens: Keyboard hook installed with ID: {_keyboardHookId}");
            }
        }

        private static void UninstallKeyboardHook()
        {
            if (_keyboardHookId != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_keyboardHookId);
                _keyboardHookId = IntPtr.Zero;
            }
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
                Debug.WriteLine($"DeepLens: Mouse hook installed with ID: {_mouseHookId}");
            }
        }

        private static void UninstallMouseHook()
        {
            if (_mouseHookId != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_mouseHookId);
                _mouseHookId = IntPtr.Zero;
                Debug.WriteLine("DeepLens: Mouse hook uninstalled");
            }
        }

        private static IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int vkCode = Marshal.ReadInt32(lParam);
                bool isShiftKey = vkCode == VK_SHIFT || vkCode == VK_LSHIFT || vkCode == VK_RSHIFT;

                if (isShiftKey)
                {
                    if (wParam == (IntPtr)WM_KEYDOWN)
                    {
                        if (!_wasShiftPressed)
                        {
                            _wasShiftPressed = true;
                        }
                    }
                    else if (wParam == (IntPtr)WM_KEYUP)
                    {
                        if (_wasShiftPressed)
                        {
                            _wasShiftPressed = false;
                            var now = DateTime.Now;
                            var timeSinceLastPress = (now - _lastShiftPressTime).TotalMilliseconds;

                            if (timeSinceLastPress < DoubleShiftThresholdMs && timeSinceLastPress > 50)
                            {
                                _lastShiftPressTime = DateTime.MinValue;
                                OnDoubleShiftDetected();
                            }
                            else
                            {
                                _lastShiftPressTime = now;
                            }
                        }
                    }
                }
                else if (wParam == (IntPtr)WM_KEYDOWN)
                {
                    _lastShiftPressTime = DateTime.MinValue;
                    _wasShiftPressed = false;
                }
            }

            return CallNextHookEx(_keyboardHookId, nCode, wParam, lParam);
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
                                Debug.WriteLine($"DeepLens: Click outside detected at {clickPoint}, closing window");
                                _searchWindow.Close();
                            }
                        }
                    });
                }
            }

            return CallNextHookEx(_mouseHookId, nCode, wParam, lParam);
        }

        private static bool IsVisualStudioFocused()
        {
            try
            {
                IntPtr foregroundWindow = GetForegroundWindow();
                if (foregroundWindow == IntPtr.Zero)
                    return false;

                GetWindowThreadProcessId(foregroundWindow, out uint foregroundProcessId);
                uint currentProcessId = (uint)Process.GetCurrentProcess().Id;

                return foregroundProcessId == currentProcessId;
            }
            catch
            {
                return false;
            }
        }

        private static void OnDoubleShiftDetected()
        {
            if (!IsVisualStudioFocused())
                return;

            Microsoft.VisualStudio.Shell.ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await Microsoft.VisualStudio.Shell.ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                ToggleSearchWindow();
            });
        }

        private static void ToggleSearchWindow()
        {
            Microsoft.VisualStudio.Shell.ThreadHelper.ThrowIfNotOnUIThread();

            // If window is already open, close it (toggle behavior)
            if (_searchWindow != null && _searchWindow.IsVisible)
            {
                _searchWindow.Close();
                return;
            }

            ShowSearchWindow();
        }

        private static void ShowSearchWindow()
        {
            Microsoft.VisualStudio.Shell.ThreadHelper.ThrowIfNotOnUIThread();

            try
            {
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
                        System.Windows.Media.Color.FromArgb(1, 0, 0, 0)) // Nearly transparent for hit testing
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

                // Handle Escape key
                _searchWindow.PreviewKeyDown += (s, e) =>
                {
                    if (e.Key == Key.Escape)
                    {
                        _searchWindow?.Close();
                        e.Handled = true;
                    }
                };

                // Clean up when window closes
                _searchWindow.Closed += (s, e) =>
                {
                    UninstallMouseHook();
                    _searchWindow = null;
                };

                // Install mouse hook to detect clicks outside
                InstallMouseHook();

                _searchWindow.Show();
                _searchWindow.Activate();

                // Ensure the window and search textbox get focus
                _searchWindow.Focus();
                searchControl.Focus();
                Keyboard.Focus(searchControl);

                Debug.WriteLine("DeepLens: Search window shown with mouse hook");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Error showing search window: {ex.Message}");
                UninstallMouseHook();
            }
        }
    }
}
