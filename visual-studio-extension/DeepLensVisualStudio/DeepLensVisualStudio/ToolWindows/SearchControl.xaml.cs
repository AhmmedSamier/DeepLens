using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using DeepLensVisualStudio.Services;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.VisualStudio.TextManager.Interop;
using Microsoft.VisualStudio;

namespace DeepLensVisualStudio.ToolWindows
{
    /// <summary>
    /// Converts a string to Visibility - Visible if not empty, Collapsed otherwise.
    /// </summary>
    public class StringToVisibilityConverter : IValueConverter
    {
        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            return string.IsNullOrEmpty(value as string) ? Visibility.Collapsed : Visibility.Visible;
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            throw new NotImplementedException();
        }
    }

    public class RelayCommand : ICommand
    {
        private readonly Action<object> _execute;
        public RelayCommand(Action<object> execute) => _execute = execute;
        public bool CanExecute(object parameter) => true;
        public void Execute(object parameter) => _execute(parameter);

        public event EventHandler CanExecuteChanged
        {
            add { }
            remove { }
        }
    }

    /// <summary>
    /// View model item for search results display.
    /// </summary>
    public class SearchResultViewModel
    {
        public string Name { get; set; } = "";
        public string Kind { get; set; } = "";
        public string FilePath { get; set; } = "";
        public string RelativePath { get; set; } = "";
        public int Line { get; set; }
        public string ContainerName { get; set; } = "";

        public ICommand? OpenToSideCommand { get; set; }
        public ICommand? RevealInExplorerCommand { get; set; }
        public ICommand? CopyPathCommand { get; set; }

        public string KindIcon
        {
            get
            {
                // Match VSCode extension icons using exact codicon Unicode values
                // Source: https://github.com/microsoft/vscode-codicons/blob/main/src/template/mapping.json
                switch (Kind.ToLowerInvariant())
                {
                    case "class": return "\uEB5B"; // symbol-class (60251 = 0xEB5B)
                    case "interface": return "\uEB61"; // symbol-interface (60257 = 0xEB61)
                    case "enum": return "\uEA95"; // symbol-enum (60053 = 0xEA95) 
                    case "function": return "\uEA8C"; // symbol-function (60044 = 0xEA8C)
                    case "method": return "\uEA8C"; // symbol-method (60044 = 0xEA8C)
                    case "property": return "\uEB65"; // symbol-property (60261 = 0xEB65)
                    case "field": return "\uEB5F"; // symbol-field (60255 = 0xEB5F)
                    case "variable": return "\uEA88"; // symbol-variable (60040 = 0xEA88)
                    case "file": return "\uEA7B"; // file (60027 = 0xEA7B)
                    case "text": return "\uEB7E"; // whole-word (60286 = 0xEB7E)
                    case "command": return "\uEB2C"; // run (60204 = 0xEB2C)
                    case "endpoint": return "\uEB01"; // globe (60161 = 0xEB01)
                    case "struct": return "\uEA91"; // symbol-structure (60049 = 0xEA91)
                    case "namespace": return "\uEA8B"; // symbol-namespace (60043 = 0xEA8B)
                    case "event": return "\uEA86"; // symbol-event (60038 = 0xEA86)
                    case "delegate": return "\uEA8B"; // symbol-object (60043 = 0xEA8B) - similar to namespace
                    case "constructor": return "\uEA8C"; // symbol-constructor (60044 = 0xEA8C) - same as method
                    default: return "\uEB63"; // symbol-misc (60259 = 0xEB63)
                }
            }
        }

        public string DirectoryPath
        {
            get
            {
                if (string.Equals(Kind, "Command", StringComparison.OrdinalIgnoreCase))
                {
                    return ContainerName;
                }

                var path = !string.IsNullOrEmpty(RelativePath) ? RelativePath : FilePath;
                try
                {
                    return Path.GetDirectoryName(path) ?? "";
                }
                catch
                {
                    return "";
                }
            }
        }

        public string Detail
        {
            get
            {
                string displayPath = !string.IsNullOrEmpty(RelativePath) ? RelativePath : FilePath;
                return Kind == "File"
                    ? displayPath
                    : $"{ContainerName} - {displayPath}";
            }
        }

        public string LineText => $":{Line}";
    }

    /// <summary>
    /// Interaction logic for SearchControl.xaml
    /// </summary>
    public partial class SearchControl : UserControl, INotifyPropertyChanged
    {
        // Static singleton LSP service - initialized once and reused across window opens
        private static LspSearchService? _sharedSearchService;
        private static readonly object ServiceLock = new object();
        
        /// <summary>
        /// Gets the shared LSP search service instance.
        /// </summary>
        public static LspSearchService? SharedSearchService => _sharedSearchService;
        private readonly HistoryService _historyService;
        private readonly SlashCommandService _slashCommandService;
        private CancellationTokenSource? _searchCts;
        private string _searchQuery = "";
        private string _statusText = "Ready";
        private string _indexingStatusText = "";
        private int _indexingProgress;
        private bool _isIndexing;
        private string _solutionRoot = "";
        private bool _filterAll = true;
        private bool _filterClasses;
        private bool _filterMethods;
        private bool _filterFiles;
        private bool _filterEndpoints;
        private bool _filterSymbols;
        private bool _filterTypes;
        private bool _filterText;


        private SearchResultViewModel? _selectedResult;

        /// <summary>
        /// Gets the singleton LSP service instance, creating it if necessary.
        /// </summary>
        public static LspSearchService GetLspService()
        {
            if (_sharedSearchService == null)
            {
                lock (ServiceLock)
                {
                    if (_sharedSearchService == null)
                    {
                        _sharedSearchService = new LspSearchService();
                    }
                }
            }
            return _sharedSearchService;
        }
        private readonly SearchToolWindow? _hostWindow;

        public event PropertyChangedEventHandler? PropertyChanged;

        public ObservableCollection<SearchResultViewModel> Results { get; } =
            new ObservableCollection<SearchResultViewModel>();

        public ICommand OpenCommand { get; }

        public string SearchQuery
        {
            get => _searchQuery;
            set
            {
                if (_searchQuery != value)
                {
                    _searchQuery = value;
                    OnPropertyChanged();
                    _ = PerformSearchAsync();
                }
            }
        }

        public string StatusText
        {
            get => _statusText;
            set
            {
                _statusText = value;
                OnPropertyChanged();
            }
        }

        public string IndexingStatusText
        {
            get => _indexingStatusText;
            set
            {
                if (_indexingStatusText != value)
                {
                    _indexingStatusText = value;
                    OnPropertyChanged();
                }
            }
        }

        public int IndexingProgress
        {
            get => _indexingProgress;
            set
            {
                if (_indexingProgress != value)
                {
                    _indexingProgress = value;
                    OnPropertyChanged();
                }
            }
        }

        public bool IsIndexing
        {
            get => _isIndexing;
            set
            {
                if (_isIndexing != value)
                {
                    _isIndexing = value;
                    OnPropertyChanged();
                }
            }
        }

        public string ResultCountText => Results.Count > 0 ? $"{Results.Count} results" : "";

        public bool FilterAll
        {
            get => _filterAll;
            set
            {
                if (_filterAll == value) return;
                _filterAll = value;
                OnPropertyChanged();
                if (value)
                {
                    ClearOtherFilters(nameof(FilterAll));
                    _ = PerformSearchAsync();
                }
            }
        }

        public bool FilterClasses
        {
            get => _filterClasses;
            set
            {
                if (_filterClasses == value) return;
                _filterClasses = value;
                OnPropertyChanged();
                if (value)
                {
                    ClearOtherFilters(nameof(FilterClasses));
                    _ = PerformSearchAsync();
                }
            }
        }

        public bool FilterMethods
        {
            get => _filterMethods;
            set
            {
                if (_filterMethods == value) return;
                _filterMethods = value;
                OnPropertyChanged();
                if (value)
                {
                    ClearOtherFilters(nameof(FilterMethods));
                    _ = PerformSearchAsync();
                }
            }
        }

        public bool FilterFiles
        {
            get => _filterFiles;
            set
            {
                if (_filterFiles == value) return;
                _filterFiles = value;
                OnPropertyChanged();
                if (value)
                {
                    ClearOtherFilters(nameof(FilterFiles));
                    _ = PerformSearchAsync();
                }
            }
        }

        public bool FilterEndpoints
        {
            get => _filterEndpoints;
            set
            {
                if (_filterEndpoints == value) return;
                _filterEndpoints = value;
                OnPropertyChanged();
                if (value)
                {
                    ClearOtherFilters(nameof(FilterEndpoints));
                    _ = PerformSearchAsync();
                }
            }
        }

        public bool FilterSymbols
        {
            get => _filterSymbols;
            set
            {
                if (_filterSymbols == value) return;
                _filterSymbols = value;
                OnPropertyChanged();
                if (value)
                {
                    ClearOtherFilters(nameof(FilterSymbols));
                    _ = PerformSearchAsync();
                }
            }
        }

        public bool FilterTypes
        {
            get => _filterTypes;
            set
            {
                if (_filterTypes == value) return;
                _filterTypes = value;
                OnPropertyChanged();
                if (value)
                {
                    ClearOtherFilters(nameof(FilterTypes));
                    _ = PerformSearchAsync();
                }
            }
        }

        public bool FilterText
        {
            get => _filterText;
            set
            {
                if (_filterText == value) return;
                _filterText = value;
                OnPropertyChanged();
                if (value)
                {
                    ClearOtherFilters(nameof(FilterText));
                    _ = PerformSearchAsync();
                }
            }
        }

        public SearchResultViewModel? SelectedResult
        {
            get => _selectedResult;
            set
            {
                if (_selectedResult != value)
                {
                    _selectedResult = value;
                    OnPropertyChanged();

                    if (value != null && (ResultsList.IsFocused || ResultsList.IsKeyboardFocusWithin))
                    {
                        PreviewResult(value);
                    }
                }
            }
        }

        public SearchControl(SearchToolWindow? hostWindow = null)
        {
            InitializeComponent();
            DataContext = this;
            _hostWindow = hostWindow;
            
            // Use shared singleton LSP service
            lock (ServiceLock)
            {
                _sharedSearchService ??= new LspSearchService();
            }

            _historyService = new HistoryService();
            _slashCommandService = new SlashCommandService();
            GetLspService().OnProgress += OnLspProgress;

            OpenCommand = new RelayCommand(p =>
            {
                if (p is SearchResultViewModel vm) NavigateToResult(vm);
            });

            // Focus search box on load
            Loaded += (s, e) =>
            {
                SearchTextBox.Focus();
                _ = InitializeLspAsync();
            };

            // Handle keyboard navigation
            SearchTextBox.PreviewKeyDown += OnSearchBoxKeyDown;
            ResultsList.PreviewMouseLeftButtonUp += OnResultSingleClick;
            ResultsList.KeyDown += OnResultsKeyDown;
            ResultsList.MouseDoubleClick += OnResultsDoubleClick;
        }

        private void OnLspProgress(ProgressInfo info)
        {
            ThreadHelper.JoinableTaskFactory.RunAsync(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                if (info.State == "start")
                {
                    IsIndexing = true;
                    IndexingProgress = 0;
                }
                else if (info.State == "end")
                {
                    IsIndexing = false;
                    IndexingProgress = 100;
                }
                else if (info.State == "report")
                {
                    IsIndexing = true;
                    if (info.Percentage.HasValue) IndexingProgress = info.Percentage.Value;
                }

                if (!string.IsNullOrEmpty(info.Message)) IndexingStatusText = info.Message;
            });
        }

        private void ClearSearchButton_Click(object sender, RoutedEventArgs e)
        {
            SearchQuery = "";
            SearchTextBox.Focus();
        }

        /// <summary>
        /// Sets the initial search text (e.g., from selected text in the editor).
        /// This will trigger a search immediately.
        /// </summary>
        public void SetInitialSearchText(string text)
        {
            if (!string.IsNullOrWhiteSpace(text))
            {
                _searchQuery = text; // Set directly to avoid double search
                OnPropertyChanged(nameof(SearchQuery));
                
                // Move cursor to end of text
                Dispatcher.BeginInvoke(new Action(() =>
                {
                    SearchTextBox.Text = text;
                    SearchTextBox.SelectAll();
                    SearchTextBox.Focus();
                }), System.Windows.Threading.DispatcherPriority.Loaded);
                
                _ = PerformSearchAsync();
            }
        }

        private async Task InitializeLspAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            
            if (_sharedSearchService == null) return;
            
            string? workspacePath = null;
            
            // Try to get solution directory from IVsSolution
            var solution = Package.GetGlobalService(typeof(SVsSolution)) as IVsSolution;
            if (solution != null && solution.GetSolutionInfo(out string dir, out string solutionFile, out _) == 0)
            {
                // The dir might be null/empty but solution file path has the full path
                if (!string.IsNullOrEmpty(dir))
                {
                    workspacePath = dir;
                }
                else if (!string.IsNullOrEmpty(solutionFile))
                {
                    // Fallback: use the solution file's directory
                    workspacePath = Path.GetDirectoryName(solutionFile);
                }
            }
            
            // Fallback: Try DTE
            if (string.IsNullOrEmpty(workspacePath))
            {
                try
                {
                    var dte = Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE;
                    if (dte?.Solution != null && !string.IsNullOrEmpty(dte.Solution.FullName))
                    {
                        workspacePath = Path.GetDirectoryName(dte.Solution.FullName);
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"DeepLens: Failed to get solution path from DTE: {ex.Message}");
                }
            }
            
            if (string.IsNullOrEmpty(workspacePath))
            {
                StatusText = "No solution open. DeepLens requires an open solution or folder.";
                return;
            }
            
            _solutionRoot = workspacePath ?? "";
            
            // Check if already initialized with the same solution
            bool isAlreadyInitialized = _sharedSearchService != null && 
                                       _sharedSearchService.LastError == null && 
                                       _sharedSearchService.ActiveRuntime != null;

            if (isAlreadyInitialized && _sharedSearchService != null)
            {
                string runtimeInfo = !string.IsNullOrEmpty(_sharedSearchService.ActiveRuntime)
                    ? $" ({char.ToUpper(_sharedSearchService.ActiveRuntime[0])}{_sharedSearchService.ActiveRuntime.Substring(1)})"
                    : "";
                StatusText = $"DeepLens Ready{runtimeInfo}";
                return;
            }
            
            StatusText = "Initializing DeepLens LSP...";
            
            var service = GetLspService();
            if (workspacePath != null && await service.InitializeAsync(workspacePath, CancellationToken.None))
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                
                string runtimeInfo = !string.IsNullOrEmpty(service.ActiveRuntime)
                    ? $" ({char.ToUpper(service.ActiveRuntime[0])}{service.ActiveRuntime.Substring(1)})"
                    : "";
                StatusText = $"DeepLens Ready{runtimeInfo}";
                ShowVsStatusBarMessage(StatusText);
                
                // If it's the first time, we might want to show indexing status
                if (service.IsIndexing)
                {
                    IndexingStatusText = "DeepLens Indexing...";
                    IsIndexing = true;
                }

                // Load history if query is empty
                if (string.IsNullOrEmpty(SearchQuery))
                {
                    _ = PerformSearchAsync();
                }
            }
            else
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                StatusText = service.LastError ?? "LSP initialization failed";
                ShowVsStatusBarMessage(StatusText);
            }
        }

        private void ShowVsStatusBarMessage(string message)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                var statusBar = Package.GetGlobalService(typeof(SVsStatusbar)) as IVsStatusbar;
                if (statusBar != null)
                {
                    statusBar.SetText(message);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Failed to update VS status bar: {ex.Message}");
            }
        }

        private bool _isUpdatingFilters;

        private void ClearOtherFilters(string currentFilter)
        {
            if (_isUpdatingFilters) return;
            _isUpdatingFilters = true;

            try
            {
                if (currentFilter != nameof(FilterAll)) FilterAll = false;
                if (currentFilter != nameof(FilterClasses)) FilterClasses = false;
                if (currentFilter != nameof(FilterMethods)) FilterMethods = false;
                if (currentFilter != nameof(FilterFiles)) FilterFiles = false;
                if (currentFilter != nameof(FilterEndpoints)) FilterEndpoints = false;
                if (currentFilter != nameof(FilterSymbols)) FilterSymbols = false;
                if (currentFilter != nameof(FilterTypes)) FilterTypes = false;
                if (currentFilter != nameof(FilterText)) FilterText = false;
            }
            finally
            {
                _isUpdatingFilters = false;
            }
        }

        private async Task PerformSearchAsync()
        {
            // Cancel previous search
            _searchCts?.Cancel();
            _searchCts = new CancellationTokenSource();
            var token = _searchCts.Token;

            // Only consider slash command complete if followed by space or using immediate triggers (#, >)
            if (!string.IsNullOrEmpty(SearchQuery))
            {
                var trimmed = SearchQuery.Trim();
                bool isImmediate = trimmed.StartsWith("#") || trimmed.StartsWith(">");
                bool isSlashComplete = SearchQuery.EndsWith(" ") && trimmed.StartsWith("/");

                if (isSlashComplete || (isImmediate && SearchQuery.Length > 0))
                {
                    var commands = _slashCommandService.GetCommands(trimmed);
                    var exactMatch = commands.FirstOrDefault(c =>
                        c.Name.Equals(trimmed, StringComparison.OrdinalIgnoreCase) ||
                        (c.Aliases != null && c.Aliases.Contains(trimmed, StringComparer.OrdinalIgnoreCase)));

                    if (exactMatch != null)
                    {
                        ExecuteSlashCommand(exactMatch.Name);
                        return;
                    }
                }
            }

            var query = SearchQuery?.Trim() ?? "";

            // Check for slash commands first
            if (query.StartsWith("/") || query.StartsWith("#") || query.StartsWith(">"))
            {
                Results.Clear();
                var commands = _slashCommandService.GetCommands(query);
                if (commands.Any())
                {
                foreach (var cmd in commands)
                    {
                        var primaryAlias = _slashCommandService.GetPrimaryAlias(cmd);
                        var description = !string.IsNullOrEmpty(cmd.KeyboardShortcut) 
                            ? $"{cmd.Description} • {cmd.KeyboardShortcut}" 
                            : cmd.Description;

                        Results.Add(new SearchResultViewModel
                        {
                            Name = primaryAlias,
                            Kind = "Command",
                            ContainerName = _slashCommandService.GetCategoryLabel(cmd.Category),
                            FilePath = "",
                            RelativePath = "",
                            Line = 0
                        });
                    }
                    OnPropertyChanged(nameof(ResultCountText));
                    StatusText = "Select a command to switch filter";
                    return;
                }
            }

            if (query.Length < 2)
            {
                Results.Clear();

                if (string.IsNullOrWhiteSpace(query))
                {
                    var lspService = GetLspService();
                    if (lspService != null)
                    {
                        var recentItems = await lspService.GetRecentItemsAsync(20, token);
                        foreach (var item in recentItems)
                        {
                            string relative = item.FilePath;
                            if (!string.IsNullOrEmpty(_solutionRoot) &&
                                relative.StartsWith(_solutionRoot, StringComparison.OrdinalIgnoreCase))
                            {
                                relative = relative.Substring(_solutionRoot.Length).TrimStart('\\', '/');
                            }

                            Results.Add(new SearchResultViewModel
                            {
                                Name = item.Name,
                                Kind = item.Kind,
                                FilePath = item.FilePath,
                                RelativePath = relative,
                                Line = item.Line,
                                ContainerName = item.ContainerName
                            });
                        }
                    }
                    
                    if (Results.Count == 0)
                    {
                        var history = _historyService.GetHistory();
                        foreach (var item in history)
                        {
                            Results.Add(new SearchResultViewModel
                            {
                                Name = item.Name,
                                Kind = item.Kind,
                                FilePath = item.FilePath,
                                RelativePath = item.RelativePath,
                                Line = item.Line,
                                ContainerName = item.ContainerName
                            });
                        }
                    }
                    StatusText = Results.Count > 0 ? "Recent items" : "Ready";
                }
                else
                {
                    StatusText = "Type at least 2 characters to search";
                }

                OnPropertyChanged(nameof(ResultCountText));
                return;
            }

            StatusText = "Searching...";

            // Clear results immediately so user knows search is in progress
            Results.Clear();
            OnPropertyChanged(nameof(ResultCountText));

            try
            {
                // Add debounce
                await Task.Delay(150, token);

                string scope = "everything";
                if (FilterClasses) scope = "types"; // classes are types in LSP
                else if (FilterMethods) scope = "symbols";
                else if (FilterFiles) scope = "files";
                else if (FilterEndpoints) scope = "endpoints";
                else if (FilterSymbols) scope = "symbols";
                else if (FilterTypes) scope = "types";
                else if (FilterText) scope = "text";

                var searchResults = await _sharedSearchService.SearchAsync(query, scope, token);

                if (token.IsCancellationRequested)
                    return;

                Results.Clear();
                foreach (var result in searchResults)
                {
                    string relative = result.FilePath;
                    if (!string.IsNullOrEmpty(_solutionRoot) &&
                        relative.StartsWith(_solutionRoot, StringComparison.OrdinalIgnoreCase))
                    {
                        relative = relative.Substring(_solutionRoot.Length).TrimStart('\\', '/');
                    }

                    var vm = new SearchResultViewModel
                    {
                        Name = result.Name,
                        Kind = result.Kind,
                        FilePath = result.FilePath,
                        RelativePath = relative,
                        Line = result.Line,
                        ContainerName = result.ContainerName,
                    };

                    vm.RevealInExplorerCommand = new RelayCommand(_ => RevealInExplorer(vm.FilePath));
                    vm.CopyPathCommand = new RelayCommand(_ => Clipboard.SetText(vm.FilePath));

                    Results.Add(vm);
                }

                OnPropertyChanged(nameof(ResultCountText));

                // Show any errors from the service
                if (Results.Count == 0 && !string.IsNullOrEmpty(_sharedSearchService.LastError))
                {
                    StatusText = _sharedSearchService.LastError;
                }
                else
                {
                    var timings = _sharedSearchService.LastTimings;
                    var timingText = $"First: {timings.FirstResultMs}ms | Total: {timings.TotalMs}ms";
                    StatusText = Results.Count > 0
                        ? $"{Results.Count} results | {timingText}"
                        : $"No results found | {timingText}";
                }
            }
            catch (OperationCanceledException)
            {
                // Search cancelled, ignore
            }
            catch (Exception ex)
            {
                StatusText = $"Error: {ex.Message}";
            }
        }

        private void OnSearchBoxKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Down && Results.Count > 0)
            {
                ResultsList.Focus();
                ResultsList.SelectedIndex = 0;
                e.Handled = true;
            }
            else if (e.Key == Key.Enter && Results.Count > 0)
            {
                NavigateToResult(Results[0]);
                e.Handled = true;
            }
            else if (e.Key == Key.Escape)
            {
                ReturnFocusToEditor();
                e.Handled = true;
            }
        }

        private void OnResultsKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter && SelectedResult != null)
            {
                NavigateToResult(SelectedResult);
                e.Handled = true;
            }
            else if (e.Key == Key.Up && ResultsList.SelectedIndex == 0)
            {
                SearchTextBox.Focus();
                e.Handled = true;
            }
        }

        private void OnResultSingleClick(object sender, MouseButtonEventArgs e)
        {
            // Only handle single clicks to avoid interfering with double-click promotion
            if (e.ClickCount != 1)
                return;

            // Don't navigate if clicking on action buttons
            if (e.OriginalSource is System.Windows.Controls.Button)
                return;

            // Single click ensures selection, which triggers PreviewResult via the property setter.
            // If already selected, we call it explicitly to ensure the preview is shown.
            if (SelectedResult != null)
            {
                PreviewResult(SelectedResult);
            }
        }

        private void OnResultsDoubleClick(object sender, MouseButtonEventArgs e)
        {
            if (SelectedResult != null)
            {
                NavigateToResult(SelectedResult);
            }
        }

        private void PreviewResult(SearchResultViewModel result)
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            if (string.IsNullOrEmpty(result.FilePath) || result.Kind == "Command")
                return;

            try
            {
                using (new NewDocumentStateScope(__VSNEWDOCUMENTSTATE.NDS_Provisional | __VSNEWDOCUMENTSTATE.NDS_NoActivate, VSConstants.NewDocumentStateReason.SolutionExplorer))
                {
                    IVsWindowFrame? frame;
                    VsShellUtilities.OpenDocument(
                        ServiceProvider.GlobalProvider,
                        result.FilePath,
                        Guid.Empty,
                        out _,
                        out _,
                        out frame);

                    if (frame != null)
                    {
                        frame.ShowNoActivate();

                        var textView = VsShellUtilities.GetTextView(frame);
                        if (textView != null)
                        {
                            int column = GetMatchColumn(textView, result);
                            int endColumn = column + (result.Name?.Length ?? 0);
                            if (result.Line > 0)
                            {
                                textView.GetBuffer(out IVsTextLines buffer);
                                if (buffer != null)
                                {
                                    buffer.GetLengthOfLine(result.Line - 1, out int lineLength);
                                    if (endColumn > lineLength)
                                    {
                                        endColumn = lineLength;
                                    }
                                }
                            }

                            textView.SetCaretPos(result.Line - 1, column);
                            textView.SetSelection(result.Line - 1, column, result.Line - 1, endColumn);
                            textView.CenterLines(result.Line - 1, 1);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Preview error: {ex.Message}");
            }
        }

        private void NavigateToResult(SearchResultViewModel result)
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            if (result.Kind == "Command")
            {
                ExecuteSlashCommand(result.Name);
                return;
            }

            try
            {
                if (string.IsNullOrEmpty(result.FilePath))
                    return;

                IVsWindowFrame? frame;

                VsShellUtilities.OpenDocument(
                    ServiceProvider.GlobalProvider,
                    result.FilePath,
                    Guid.Empty,
                    out _,
                    out _,
                    out frame);

                frame?.Show();
                frame?.SetProperty((int)__VSFPROPID5.VSFPROPID_IsProvisional, false);

                if (frame != null)
                {
                    var textView = VsShellUtilities.GetTextView(frame);
                    if (textView != null)
                    {
                        int column = GetMatchColumn(textView, result);
                        int endColumn = column + (result.Name?.Length ?? 0);
                        if (result.Line > 0)
                        {
                            textView.GetBuffer(out IVsTextLines buffer);
                            if (buffer != null)
                            {
                                buffer.GetLengthOfLine(result.Line - 1, out int lineLength);
                                if (endColumn > lineLength)
                                {
                                    endColumn = lineLength;
                                }
                            }
                        }

                        textView.SetCaretPos(result.Line - 1, column);
                        textView.SetSelection(result.Line - 1, column, result.Line - 1, endColumn);
                        textView.CenterLines(result.Line - 1, 1);
                    }
                }

                StatusText = $"Opened {result.Name}";

                var lspService = GetLspService();
                if (lspService != null)
                {
                    string itemId = result.Kind == "File" ? $"file:{result.FilePath}" : $"symbol:{result.FilePath}:{result.Name}:{result.Line - 1}";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await lspService.RecordActivityAsync(itemId);
                        }
                        catch
                        {
                        }
                    });
                }

                _historyService.AddItem(new HistoryItem
                {
                    Name = result.Name,
                    Kind = result.Kind,
                    FilePath = result.FilePath,
                    RelativePath = result.RelativePath,
                    Line = result.Line,
                    ContainerName = result.ContainerName
                });
            }
            catch (Exception ex)
            {
                StatusText = $"Error opening file: {ex.Message}";
            }
        }

        private void RevealInExplorer(string filePath)
        {
            try
            {
                if (System.IO.File.Exists(filePath))
                {
                    System.Diagnostics.Process.Start("explorer.exe", $"/select,\"{filePath}\"");
                }
            }
            catch (Exception ex)
            {
                StatusText = $"Error revealing in explorer: {ex.Message}";
            }
        }

        private void ReturnFocusToEditor()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            try
            {
                var dte = Package.GetGlobalService(typeof(EnvDTE.DTE)) as EnvDTE.DTE;
                dte?.ActiveDocument?.Activate();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"DeepLens: Error returning focus to editor: {ex.Message}");
            }
        }

        protected void OnPropertyChanged([CallerMemberName] string? propertyName = null)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }

        private int GetMatchColumn(IVsTextView textView, SearchResultViewModel result)
        {
            if (result.Line <= 0)
            {
                return 0;
            }

            textView.GetBuffer(out IVsTextLines buffer);
            if (buffer == null)
            {
                return 0;
            }

            buffer.GetLineText(result.Line - 1, 0, result.Line - 1, -1, out string lineText);
            if (string.IsNullOrEmpty(lineText))
            {
                return 0;
            }

            string name = result.Name ?? string.Empty;
            if (name.Length == 0)
            {
                return 0;
            }

            int index = lineText.IndexOf(name, StringComparison.Ordinal);
            if (index < 0)
            {
                string trimmedName = name.Trim();
                if (trimmedName.Length > 0)
                {
                    index = lineText.IndexOf(trimmedName, StringComparison.Ordinal);
                    if (index < 0)
                    {
                        index = lineText.IndexOf(trimmedName, StringComparison.OrdinalIgnoreCase);
                    }
                }
            }

            if (index < 0)
            {
                int leadingWhitespace = lineText.Length - lineText.TrimStart().Length;
                index = leadingWhitespace;
            }

            if (index < 0)
            {
                index = 0;
            }

            return index;
        }

        private void ExecuteSlashCommand(string commandName)
        {
            var cmd = _slashCommandService.GetCommand(commandName);
            if (cmd != null)
            {
                _slashCommandService.RecordUsage(cmd.Name);
                
                switch (cmd.Name.ToLowerInvariant())
                {
                    case "/all":
                    case "/a":
                        FilterAll = true;
                        break;
                    case "/t":
                    case "/classes":
                    case "/types":
                    case "/type":
                    case "/c":
                        FilterClasses = true;
                        break;
                    case "/s":
                    case "/symbols":
                    case "/symbol":
                        FilterSymbols = true;
                        break;
                    case "/f":
                    case "/files":
                    case "/file":
                        FilterFiles = true;
                        break;
                    case "/txt":
                    case "/text":
                    case "/find":
                    case "/grep":
                        FilterText = true;
                        break;
                    case "/e":
                    case "/endpoints":
                    case "/endpoint":
                    case "/routes":
                    case "/api":
                        FilterEndpoints = true;
                        break;
                    case "/o":
                    case "/open":
                    case "/opened":
                        FilterAll = true;
                        break;
                    case "/m":
                    case "/modified":
                    case "/mod":
                    case "/git":
                    case "/changed":
                        FilterAll = true;
                        break;
                    case "/p":
                    case "/properties":
                    case "/prop":
                    case "/field":
                        FilterAll = true;
                        break;
                    case "/cmd":
                    case "/commands":
                    case "/action":
                    case "/run":
                        FilterAll = true;
                        break;
                }
            }
            SearchQuery = "";
        }
    }
}
