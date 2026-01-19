using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
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
    [ProvideToolWindow(typeof(ToolWindows.SearchToolWindow), Style = VsDockStyle.Float, Window = "DocumentWell")]
    [ProvideBindingPath]
    public sealed class DeepLensPackage : AsyncPackage
    {
        public const string PackageGuidString = "a1b2c3d4-e5f6-4a5b-9c8d-7e6f5a4b3c2d";
        
        private static DeepLensPackage? _instance;

        private static IntPtr _keyboardHookId = IntPtr.Zero;
        private static LowLevelKeyboardProc? _keyboardProc;
        private static DateTime _lastShiftPressTime = DateTime.MinValue;
        private static bool _wasShiftPressed;
        private const int DoubleShiftThresholdMs = 400;

        // Win32 constants for keyboard hook
        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_KEYUP = 0x0101;
        private const int VK_SHIFT = 0x10;
        private const int VK_LSHIFT = 0xA0;
        private const int VK_RSHIFT = 0xA1;

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

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
            
            // Store instance for static access
            _instance = this;

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
                _instance = null;
            }

            base.Dispose(disposing);
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
                ToggleSearchWindow();
            });
        }

        private static void ToggleSearchWindow()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            
            if (_instance == null)
            {
                Debug.WriteLine("DeepLens: Package instance not available");
                return;
            }

            // Use JoinableTaskFactory to call async method
            _instance.JoinableTaskFactory.RunAsync(async () =>
            {
                await ShowSearchToolWindowAsync();
            });
        }

        private static async System.Threading.Tasks.Task ShowSearchToolWindowAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

            try
            {
                if (_instance == null)
                {
                    Debug.WriteLine("DeepLens: Package instance not available");
                    return;
                }

                // Get selected text before showing window
                string selectedText = GetSelectedText();

                // Find or create the tool window
                var window = await _instance.FindToolWindowAsync(
                    typeof(ToolWindows.SearchToolWindow), 
                    0, 
                    true, 
                    _instance.DisposalToken) as ToolWindows.SearchToolWindow;

                if (window?.Frame is IVsWindowFrame frame)
                {
                    // Show the tool window
                    Microsoft.VisualStudio.ErrorHandler.ThrowOnFailure(frame.Show());
                    
                    // Focus the search box
                    window.FocusSearchBox();

                    // If there was selected text, use it as initial search
                    if (!string.IsNullOrWhiteSpace(selectedText))
                    {
                        window.SetInitialSearchText(selectedText);
                    }

                    Debug.WriteLine("DeepLens: Tool window shown");
                }
                else
                {
                    Debug.WriteLine("DeepLens: Could not find or create tool window");
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Error showing tool window: {ex.Message}");
            }
        }

        /// <summary>
        /// Gets the selected text from the active text editor, if any.
        /// </summary>
        private static string GetSelectedText()
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            try
            {
                var dte = Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE;
                if (dte?.ActiveDocument != null)
                {
                    var textSelection = dte.ActiveDocument.Selection as EnvDTE.TextSelection;
                    if (textSelection != null && !string.IsNullOrEmpty(textSelection.Text))
                    {
                        // Limit to first 100 characters and single line
                        var text = textSelection.Text.Trim();
                        var firstLine = text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
                        if (!string.IsNullOrEmpty(firstLine))
                        {
                            return firstLine.Length > 100 ? firstLine.Substring(0, 100) : firstLine;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Error getting selected text: {ex.Message}");
            }

            return string.Empty;
        }
    }
}
