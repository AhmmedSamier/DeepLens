using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using Microsoft.VisualStudio.Extensibility;
using Microsoft.VisualStudio.Extensibility.UI;
using System.Runtime.Serialization;
using System.Threading.Tasks;
using System.Threading;
using System.Windows.Input;
using Microsoft.VisualStudio.ProjectSystem.Query;

namespace DeepLensVS
{
    [DataContract]
    public class SearchViewModel : NotifyPropertyChangedObject, System.IDisposable
    {
        private readonly VisualStudioExtensibility extensibility;
        private string searchText = string.Empty;
        private string placeholderText = "Type to search everywhere with DeepLens...";
        private string title = "DeepLens";
        private bool isBusy = false;
        private SearchScope currentScope = SearchScope.Everything;

        private string themeBackgroundColor = "#ffffff";
        private string themeForegroundColor = "#000000";
        private string themeBorderColor = "#cccccc";

        public SearchViewModel(VisualStudioExtensibility extensibility)
        {
            this.extensibility = extensibility;
            Results = new ObservableCollection<SearchResultItemViewModel>();
            
            FilterEverythingCommand = new AsyncCommand(async (_, cancellationToken) => await SetScopeAsync(SearchScope.Everything));
            FilterClassesCommand = new AsyncCommand(async (_, cancellationToken) => await SetScopeAsync(SearchScope.Types));
            FilterSymbolsCommand = new AsyncCommand(async (_, cancellationToken) => await SetScopeAsync(SearchScope.Symbols));
            FilterFilesCommand = new AsyncCommand(async (_, cancellationToken) => await SetScopeAsync(SearchScope.Files));
            FilterCommandsCommand = new AsyncCommand(async (_, cancellationToken) => await SetScopeAsync(SearchScope.Commands));
            FilterPropertiesCommand = new AsyncCommand(async (_, cancellationToken) => await SetScopeAsync(SearchScope.Properties));
            FilterEndpointsCommand = new AsyncCommand(async (_, cancellationToken) => await SetScopeAsync(SearchScope.Endpoints));
            
            DetectTheme();

            LspManager.Client.OnIndexingProgress = (progress) =>
            {
                UpdateTitle();
            };

            // Start LSP with solution path
            _ = Task.Run(async () => {
                string? solutionUri = null;
                try 
                {
                    Logger.Log("Starting solution query...");
                    var query = await extensibility.Workspaces().QuerySolutionAsync(
                        solution => solution.With(s => s.Path),
                        CancellationToken.None);
                    var snapshot = query.FirstOrDefault();
                    if (snapshot != null)
                    {
                        Logger.Log($"Snapshot found. Path: {snapshot.Path}");
                        var solutionDir = System.IO.Path.GetDirectoryName(snapshot.Path);
                        if (!string.IsNullOrEmpty(solutionDir))
                        {
                            solutionUri = new Uri(solutionDir).ToString();
                            Logger.Log($"Solution URI set to: {solutionUri}");
                        }
                    }
                    else
                    {
                        Logger.Log("No solution snapshot returned.");
                    }
                }
                catch (Exception ex)
                {
                    Logger.LogError("Error querying solution", ex);
                }
                
                Logger.Log($"Calling EnsureStartedAsync with uri: {solutionUri ?? "null"}");
                await LspManager.EnsureStartedAsync(solutionUri);
                
                // Show initial results once started
                await OnSearchTextChangedAsync();
            });
        }

        [DataMember]
        public string ThemeBackgroundColor { get => themeBackgroundColor; set => SetProperty(ref themeBackgroundColor, value); }
        [DataMember]
        public string ThemeForegroundColor { get => themeForegroundColor; set => SetProperty(ref themeForegroundColor, value); }
        [DataMember]
        public string ThemeBorderColor { get => themeBorderColor; set => SetProperty(ref themeBorderColor, value); }

        private void DetectTheme()
        {
            try
            {
                // In VS 2022/2026, the theme is stored in the registry.
                // We'll try to guess based on standard keys.
                // Dark Theme GUID: {1ded0138-47ce-435e-84ef-9ec1f439b749}
                using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\VisualStudio\18.0_283f9e82Exp\General");
                var themeValue = key?.GetValue("ColorTheme")?.ToString();

                if (themeValue != null && themeValue.Contains("1ded0138-47ce-435e-84ef-9ec1f439b749", StringComparison.OrdinalIgnoreCase))
                {
                    // Dark Mode
                    ThemeBackgroundColor = "#1e1e1e";
                    ThemeForegroundColor = "#ffffff";
                    ThemeBorderColor = "#3e3e42";
                }
                else
                {
                    // Default to Light Mode
                    ThemeBackgroundColor = "#ffffff";
                    ThemeForegroundColor = "#000000";
                    ThemeBorderColor = "#cccccc";
                }
            }
            catch
            {
                // Fallback
                ThemeBackgroundColor = "#ffffff";
                ThemeForegroundColor = "#000000";
                ThemeBorderColor = "#cccccc";
            }
        }

        [DataMember]
        public string SearchText
        {
            get => searchText;
            set
            {
                if (SetProperty(ref searchText, value))
                {
                    _ = OnSearchTextChangedAsync();
                }
            }
        }

        [DataMember]
        public string PlaceholderText
        {
            get => placeholderText;
            set => SetProperty(ref placeholderText, value);
        }

        [DataMember]
        public string Title
        {
            get => title;
            set => SetProperty(ref title, value);
        }

        [DataMember]
        public bool IsBusy
        {
            get => isBusy;
            set => SetProperty(ref isBusy, value);
        }

        [DataMember]
        public ObservableCollection<SearchResultItemViewModel> Results { get; }

        [DataMember]
        public IAsyncCommand FilterEverythingCommand { get; }
        [DataMember]
        public IAsyncCommand FilterClassesCommand { get; }
        [DataMember]
        public IAsyncCommand FilterSymbolsCommand { get; }
        [DataMember]
        public IAsyncCommand FilterFilesCommand { get; }
        [DataMember]
        public IAsyncCommand FilterCommandsCommand { get; }
        [DataMember]
        public IAsyncCommand FilterPropertiesCommand { get; }
        [DataMember]
        public IAsyncCommand FilterEndpointsCommand { get; }

        private async Task SetScopeAsync(SearchScope scope)
        {
            currentScope = scope;
            UpdatePlaceholderText();
            await OnSearchTextChangedAsync();
        }

        private void UpdatePlaceholderText()
        {
            PlaceholderText = currentScope switch
            {
                SearchScope.Types => "Searching in Classes only. Type to search...",
                SearchScope.Symbols => "Searching in Symbols only. Type to search...",
                SearchScope.Files => "Searching in Files only. Type to search...",
                SearchScope.Commands => "Searching in Commands only. Type to search...",
                SearchScope.Properties => "Searching in Properties only. Type to search...",
                SearchScope.Endpoints => "Searching in Endpoints only. Type to search...",
                _ => "Type to search everywhere with DeepLens (files, classes, symbols...)"
            };
        }

        private CancellationTokenSource? searchCts;

        private async Task OnSearchTextChangedAsync()
        {
            if (searchCts != null)
            {
                await searchCts.CancelAsync();
            }
            searchCts = new CancellationTokenSource();
            var token = searchCts.Token;

            IsBusy = true;
            
            try
            {
                if (!LspManager.Client.IsRunning)
                {
                    await LspManager.EnsureStartedAsync(null);
                }

                if (!LspManager.Client.IsRunning)
                {
                    Title = "DeepLens - LSP Server Not Found";
                    return;
                }

                if (string.IsNullOrWhiteSpace(SearchText))
                {
                    await PerformSearchAsync("deeplens/search", token); // Get recent items
                    return;
                }

                // Tiered Search (snappy!)
                
                // Tier 1: Instant Burst
                await PerformSearchAsync("deeplens/burstSearch", token, 5);
                if (token.IsCancellationRequested) return;

                // Tier 2: Deeper Burst
                await Task.Delay(20, token);
                await PerformSearchAsync("deeplens/burstSearch", token, 15);
                if (token.IsCancellationRequested) return;

                // Tier 3: Full Fuzzy
                await Task.Delay(100, token);
                await PerformSearchAsync("deeplens/search", token, 50);
            }
            catch (OperationCanceledException) { }
            catch (System.Exception ex)
            {
                Title = $"Search Error: {ex.Message}";
            }
            finally
            {
                if (!token.IsCancellationRequested)
                {
                    IsBusy = false;
                }
            }
        }

        private async Task PerformSearchAsync(string method, CancellationToken token, int maxResults = 50)
        {
            try
            {
                var options = new LspSearchOptions
                {
                    Query = SearchText ?? string.Empty,
                    Scope = currentScope.ToString().ToLowerInvariant(),
                    MaxResults = maxResults,
                    EnableCamelHumps = true
                };

                Logger.Log($"Sending Search Request: {method}, Query: '{options.Query}'");
                var lspResults = await LspManager.Client.SendRequestAsync<LspSearchResult[]>(method, options);
                
                if (token.IsCancellationRequested) 
                {
                    Logger.Log("Search cancelled.");
                    return;
                }

                // Use a local list to avoid UI flickering if possible, or just clear and add if small
                Results.Clear();

                if (lspResults != null)
                {
                     Logger.Log($"Received {lspResults.Length} results.");
                    foreach (var res in lspResults)
                    {
                        AddResult(res.Item);
                    }
                }
                else
                {
                    Logger.Log("Received null results.");
                }

                UpdateTitle();
            }
            catch (Exception ex)
            {
                 Logger.LogError($"Search failed: {method}", ex);
            }
        }

        private void UpdateTitle()
        {
            string status = "";
            if (LspManager.Client.IndexingProgress < 100)
            {
                status = $" [Indexing {(int)LspManager.Client.IndexingProgress}%]";
            }

            if (Results.Count > 0)
            {
                Title = string.IsNullOrWhiteSpace(SearchText) ? $"DeepLens - Recent Items{status}" : $"DeepLens - ({Results.Count} results){status}";
            }
            else if (!string.IsNullOrWhiteSpace(SearchText))
            {
                Title = $"DeepLens - No results found{status}";
            }
            else
            {
                Title = $"DeepLens{status}";
            }
        }

        private string GetIconForItemType(string type)
        {
            return type.ToLower() switch
            {
                "file" => "📄",
                "class" or "interface" or "enum" => "📦",
                "function" or "method" => "🧩",
                "command" => "⚡",
                "endpoint" => "🌐",
                "property" or "variable" => "🔧",
                _ => "🔍"
            };
        }

        private void AddResult(LspSearchableItem item)
        {
            var icon = GetIconForItemType(item.Type);
            var description = item.Type;
            if (!string.IsNullOrEmpty(item.ContainerName))
            {
                description = $"{item.Type} in {item.ContainerName}";
            }

            var detail = item.RelativeFilePath ?? item.FilePath;
            if (item.Line.HasValue)
            {
                detail += $" : {item.Line + 1}";
            }

            var vm = new SearchResultItemViewModel
            {
                Label = item.Name,
                Description = description,
                Detail = detail,
                IconSymbol = icon,
                FilePath = item.FilePath,
                Line = item.Line,
                Column = item.Column,
                ItemId = item.Id,
                ThemeForegroundColor = this.ThemeForegroundColor,
                NavigateCommand = new AsyncCommand(async (p, ct) => await NavigateToResultAsync((SearchResultItemViewModel)p!, ct))
            };
            Results.Add(vm);
        }

        private async Task NavigateToResultAsync(SearchResultItemViewModel item, CancellationToken cancellationToken)
        {
            if (string.IsNullOrEmpty(item.FilePath)) return;

            try
            {
                // Record activity
                if (LspManager.Client.IsRunning && !string.IsNullOrEmpty(item.ItemId))
                {
                    _ = LspManager.Client.SendNotificationAsync("deeplens/recordActivity", new { itemId = item.ItemId });
                }

                if (item.Description == "command")
                {
                    // Handle command execution if needed, but for now just open file if it's a command defined in code
                }

                var uri = new System.Uri(item.FilePath);
                var document = await extensibility.Documents().OpenTextDocumentAsync(uri, cancellationToken);
                
                if (item.Line.HasValue)
                {
                    // In VisualStudio.Extensibility, navigating to a specific line/column might need more work
                    // than just opening the document.
                    // For now, we open it.
                }
            }
            catch (System.Exception ex)
            {
                Title = $"Error opening file: {ex.Message}";
            }
        }

        public void Dispose()
        {
        }
    }

    [DataContract]
    public class SearchResultItemViewModel : NotifyPropertyChangedObject
    {
        private string label = string.Empty;
        private string description = string.Empty;
        private string detail = string.Empty;
        private string iconSymbol = "📄";
        private string filePath = string.Empty;
        private string itemId = string.Empty;
        private int? line;
        private int? column;

        private string themeForegroundColor = "#000000";

        [DataMember]
        public string Label
        {
            get => label;
            set => SetProperty(ref label, value);
        }

        [DataMember]
        public string ThemeForegroundColor
        {
            get => themeForegroundColor;
            set => SetProperty(ref themeForegroundColor, value);
        }

        [DataMember]
        public string Description
        {
            get => description;
            set => SetProperty(ref description, value);
        }

        [DataMember]
        public string Detail
        {
            get => detail;
            set => SetProperty(ref detail, value);
        }

        [DataMember]
        public string IconSymbol
        {
            get => iconSymbol;
            set => SetProperty(ref iconSymbol, value);
        }

        [DataMember]
        public string FilePath
        {
            get => filePath;
            set => SetProperty(ref filePath, value);
        }

        [DataMember]
        public string ItemId
        {
            get => itemId;
            set => SetProperty(ref itemId, value);
        }

        [DataMember]
        public int? Line
        {
            get => line;
            set => SetProperty(ref line, value);
        }

        [DataMember]
        public int? Column
        {
            get => column;
            set => SetProperty(ref column, value);
        }

        [DataMember]
        public IAsyncCommand? NavigateCommand { get; set; }
    }

    public enum SearchScope
    {
        Everything,
        Types,
        Symbols,
        Files,
        Commands,
        Properties,
        Endpoints
    }
}
