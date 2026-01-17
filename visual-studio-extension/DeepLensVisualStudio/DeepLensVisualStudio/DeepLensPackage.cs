using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using DeepLensVisualStudio.ToolWindows;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Task = System.Threading.Tasks.Task;

namespace DeepLensVisualStudio
{
    /// <summary>
    /// AsyncPackage that initializes the double-shift keyboard hook when Visual Studio starts.
    /// This ensures the shortcut works immediately without needing to invoke any command first.
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [Guid(PackageGuidString)]
    [ProvideAutoLoad(VSConstants.UICONTEXT.ShellInitialized_string, PackageAutoLoadFlags.BackgroundLoad)]
    [ProvideBindingPath]
    public sealed class DeepLensPackage : AsyncPackage
    {
        public const string PackageGuidString = "a1b2c3d4-e5f6-4a5b-9c8d-7e6f5a4b3c2d";

        private static IntPtr _hookId = IntPtr.Zero;
        private static LowLevelKeyboardProc? _proc;
        private static DateTime _lastShiftPressTime = DateTime.MinValue;
        private static bool _wasShiftPressed = false;
        private const int DoubleShiftThresholdMs = 400;
        private static Window? _searchWindow;

        // Win32 constants
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int VK_SHIFT = 0x10;
        private const int VK_LSHIFT = 0xA0;
        private const int VK_RSHIFT = 0xA1;

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod,
            uint dwThreadId);

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

        protected override async Task InitializeAsync(CancellationToken cancellationToken,
            IProgress<ServiceProgressData> progress)
        {
            await base.InitializeAsync(cancellationToken, progress);

            // Switch to UI thread to install keyboard hook
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            try
            {
                InstallKeyboardHook();
                Debug.WriteLine("DeepLens: Double-shift keyboard hook installed at startup");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Failed to install keyboard hook: {ex.Message}");
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                UninstallKeyboardHook();
            }

            base.Dispose(disposing);
        }

        private static void InstallKeyboardHook()
        {
            if (_hookId != IntPtr.Zero)
                return;

            _proc = HookCallback;
            using var curProcess = Process.GetCurrentProcess();
            using var curModule = curProcess.MainModule;

            if (curModule != null)
            {
                _hookId = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(curModule.ModuleName), 0);
                Debug.WriteLine($"DeepLens: Keyboard hook installed with ID: {_hookId}");
            }
        }

        private static void UninstallKeyboardHook()
        {
            if (_hookId != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_hookId);
                _hookId = IntPtr.Zero;
            }
        }

        private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
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

            return CallNextHookEx(_hookId, nCode, wParam, lParam);
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

            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                ShowSearchWindow();
            });
        }

        private static void ShowSearchWindow()
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            try
            {
                if (_searchWindow != null && _searchWindow.IsVisible)
                {
                    _searchWindow.Activate();
                    return;
                }

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

                _searchWindow.PreviewKeyDown += (s, e) =>
                {
                    if (e.Key == System.Windows.Input.Key.Escape)
                    {
                        _searchWindow.Close();
                        e.Handled = true;
                    }
                };

                _searchWindow.Closed += (s, e) => _searchWindow = null;

                _searchWindow.Show();
                _searchWindow.Activate();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Error showing search window: {ex.Message}");
            }
        }
    }
}
