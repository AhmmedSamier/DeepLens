using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using DeepLensVisualStudio.Services;
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
    [ProvideOptionPage(typeof(DeepLensOptionsPage), "DeepLens", "General", 0, 0, true)]
    [ProvideBindingPath]
    public sealed class DeepLensPackage : AsyncPackage, IVsSolutionEvents
    {
        public const string PackageGuidString = "a1b2c3d4-e5f6-4a5b-9c8d-7e6f5a4b3c2d";
        
        private static DeepLensPackage? _instance;
        private uint _solutionEventsCookie;
        private KeyboardHookService? _keyboardHookService;
        private IVsStatusbar? _statusBar;
        private uint _statusBarCookie;
        private GitService? _gitService;

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
                _keyboardHookService = new KeyboardHookService();
                _keyboardHookService.DoubleShiftDetected += OnDoubleShiftDetected;
                _keyboardHookService.Install();

                Debug.WriteLine("DeepLens: Double-shift keyboard hook installed at startup");
                
                // Initialize status bar
                _statusBar = await GetServiceAsync(typeof(SVsStatusbar)) as IVsStatusbar;
                if (_statusBar != null)
                {
                    _statusBar.SetText("DeepLens");
                    // Subscribe to static progress event from LSP service
                    LspSearchService.StaticOnProgress += OnLspProgress;
                }
                
                // Initialize Git service
                _gitService = new GitService(async () =>
                {
                    var lspService = SearchControl.GetLspService();
                    if (lspService != null)
                    {
                        await lspService.RebuildIndexAsync(force: true);
                    }
                });
                await _gitService.SetupGitListenerAsync();

                // Track active files for /open scope
                await TrackActiveFilesAsync();
                
                // Register for solution events to initialize LSP early
                var solution = await GetServiceAsync(typeof(SVsSolution)) as IVsSolution;
                if (solution != null)
                {
                    solution.AdviseSolutionEvents(this, out _solutionEventsCookie);
                    
                    // If solution is already open (e.g. reload), initialize now
                    if (ErrorHandler.Succeeded(solution.GetProperty((int)__VSPROPID.VSPROPID_IsSolutionOpen, out object isOpen)) && (bool)isOpen)
                    {
                        _ = InitializeLspInBackgroundAsync();
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Initialization error: {ex.Message}");
            }
        }

        private void OnDoubleShiftDetected(object sender, EventArgs e)
        {
            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ShowSearchToolWindowAsync();
            });
        }

        private async Task InitializeLspInBackgroundAsync()
        {
            await Task.Yield(); // Don't block the UI thread during startup

            try
            {
                string? solutionPath = null;
                await JoinableTaskFactory.SwitchToMainThreadAsync();
                
                var solution = await GetServiceAsync(typeof(SVsSolution)) as IVsSolution;
                if (solution != null && ErrorHandler.Succeeded(solution.GetProperty((int)__VSPROPID.VSPROPID_SolutionDirectory, out object dir)))
                {
                    solutionPath = dir as string;
                }

                if (!string.IsNullOrEmpty(solutionPath))
                {
                    Debug.WriteLine($"DeepLens: Initializing LSP in background for {solutionPath}");
                    var service = SearchControl.GetLspService();
                    await service.InitializeAsync(solutionPath!, DisposalToken);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Background LSP init failed: {ex.Message}");
            }
        }

        private void OnLspProgress(ProgressInfo progress)
        {
            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                UpdateStatusBar(progress);
            });
        }

        private void UpdateStatusBar(ProgressInfo progress)
        {
            if (_statusBar == null) return;

            try
            {
                string icon;
                string text;
                int color = 0; // Default color

                if (progress.State == "start")
                {
                    icon = "\uE895"; // sync~spin equivalent (database icon)
                    text = "DeepLens: Indexing...";
                    color = 0x00FF9900; // Orange
                }
                else if (progress.State == "end")
                {
                    icon = "\uE8C4"; // database icon
                    text = "DeepLens";
                    color = 0x00CCCCCC; // Gray
                }
                else // report
                {
                    var message = progress.Message ?? "";
                    var percentage = progress.Percentage.HasValue ? $" ({progress.Percentage}%)" : "";
                    
                    // Determine icon and color based on message content
                    if (message.IndexOf("scanning", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        icon = "\uE8B6"; // search icon
                        color = 0x00007ACC; // Blue
                    }
                    else if (message.IndexOf("parsing", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        icon = "\uE8A7"; // code icon
                        color = 0x007C4DFF; // Purple
                    }
                    else if (message.IndexOf("indexing", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        icon = "\uE8C4"; // database icon
                        color = 0x0000C853; // Green
                    }
                    else if (message.IndexOf("symbols", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        icon = "\uE945"; // symbol-parameter icon
                        color = 0x00AA00FF; // Dark purple
                    }
                    else
                    {
                        icon = "\uE895"; // sync icon
                        color = 0x00FF9900; // Orange
                    }
                    
                    text = $"DeepLens{percentage}";
                    if (!string.IsNullOrEmpty(message))
                    {
                        text = $"DeepLens: {message}{percentage}";
                    }
                }

                _statusBar.SetText(text);
                // Note: IVsStatusbar doesn't directly support colors, but we can use icon characters
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Error updating status bar: {ex.Message}");
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                if (_solutionEventsCookie != 0)
                {
                    if (GetService(typeof(SVsSolution)) is IVsSolution solution)
                    {
                        solution.UnadviseSolutionEvents(_solutionEventsCookie);
                    }
                    _solutionEventsCookie = 0;
                }

                // Unsubscribe from LSP progress
                LspSearchService.StaticOnProgress -= OnLspProgress;

                _keyboardHookService?.Dispose();
                _keyboardHookService = null;
                _gitService?.Dispose();
                _gitService = null;
                _statusBar = null;
                _instance = null;
            }

            base.Dispose(disposing);
        }

        private async System.Threading.Tasks.Task ShowSearchToolWindowAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

            try
            {
                // Get selected text before showing window
                string selectedText = GetSelectedText();

                // Find or create the tool window
                var window = await FindToolWindowAsync(
                    typeof(ToolWindows.SearchToolWindow), 
                    0, 
                    true, 
                    DisposalToken) as ToolWindows.SearchToolWindow;

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
        private string GetSelectedText()
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            try
            {
                var dte = GetService(typeof(EnvDTE.DTE)) as EnvDTE.DTE;
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
        private async Task TrackActiveFilesAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

            try
            {
                var dte = GetService(typeof(EnvDTE.DTE)) as EnvDTE.DTE;
                if (dte == null) return;

                // Update active files initially and on document events
                UpdateActiveFiles(dte);

                // Subscribe to document events
                dte.Events.DocumentEvents.DocumentOpened += (doc) => UpdateActiveFiles(dte);
                dte.Events.DocumentEvents.DocumentClosing += (doc) => UpdateActiveFiles(dte);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Error tracking active files: {ex.Message}");
            }
        }

        private void UpdateActiveFiles(EnvDTE.DTE dte)
        {
            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();

                try
                {
                    var activeFiles = new List<string>();
                    foreach (EnvDTE.Document doc in dte.Documents)
                    {
                        if (doc != null && !string.IsNullOrEmpty(doc.FullName))
                        {
                            activeFiles.Add(doc.FullName);
                        }
                    }

                    var lspService = SearchControl.GetLspService();
                    if (lspService != null)
                    {
                        await lspService.SetActiveFilesAsync(activeFiles);
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"DeepLens: Error updating active files: {ex.Message}");
                }
            });
        }

        #region IVsSolutionEvents members

        public int OnAfterOpenProject(IVsHierarchy pHierarchy, int fAdded) => VSConstants.S_OK;
        public int OnQueryCloseProject(IVsHierarchy pHierarchy, int fRemoving, ref int pfCancel) => VSConstants.S_OK;
        public int OnBeforeCloseProject(IVsHierarchy pHierarchy, int fRemoved) => VSConstants.S_OK;
        public int OnAfterLoadProject(IVsHierarchy pHierarchy, IVsHierarchy pStubHierarchy) => VSConstants.S_OK;
        public int OnQueryUnloadProject(IVsHierarchy pRealHierarchy, ref int pfCancel) => VSConstants.S_OK;
        public int OnBeforeUnloadProject(IVsHierarchy pRealHierarchy, IVsHierarchy pStubHierarchy) => VSConstants.S_OK;
        public int OnAfterOpenSolution(object pUnkReserved, int fNewSolution)
        {
            _ = InitializeLspInBackgroundAsync();
            return VSConstants.S_OK;
        }
        public int OnQueryCloseSolution(object pUnkReserved, ref int pfCancel) => VSConstants.S_OK;
        public int OnBeforeCloseSolution(object pUnkReserved) => VSConstants.S_OK;
        public int OnAfterCloseSolution(object pUnkReserved) => VSConstants.S_OK;

        #endregion
    }
}
