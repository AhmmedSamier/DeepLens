using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;

namespace DeepLensVisualStudio.Services
{
    public class KeyboardHookService : IDisposable
    {
        private static IntPtr _keyboardHookId = IntPtr.Zero;
        private static LowLevelKeyboardProc? _keyboardProc;
        private static DateTime _lastShiftPressTime = DateTime.MinValue;
        private static bool _wasShiftPressed;
        private const int DoubleShiftThresholdMs = 400;

        // Win32 constants
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

        public event EventHandler DoubleShiftDetected;

        public void Install()
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

        public void Uninstall()
        {
            if (_keyboardHookId != IntPtr.Zero)
            {
                UnhookWindowsHookEx(_keyboardHookId);
                _keyboardHookId = IntPtr.Zero;
            }
        }

        private IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
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

        private void OnDoubleShiftDetected()
        {
            if (!IsVisualStudioFocused())
                return;

            DoubleShiftDetected?.Invoke(this, EventArgs.Empty);
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

        public void Dispose()
        {
            Uninstall();
        }
    }
}
