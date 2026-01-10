using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Runtime.Serialization;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Extensibility;
using Microsoft.VisualStudio.Extensibility.Shell;
using Microsoft.VisualStudio.Extensibility.UI;

namespace visual_studio_extension
{
    [DataContract]
    public class SearchToolWindowContentData : NotifyPropertyChangedObject
    {
        private string _searchQuery = "";
        private ObservableCollection<SearchResultViewModel> _results = new();
        private SearchResultViewModel? _selectedResult;
        private IAsyncCommand? _openResultCommand;
        private IAsyncCommand? _filterCommand;

        [DataMember]
        public string SearchQuery
        {
            get => _searchQuery;
            set
            {
                if (SetProperty(ref _searchQuery, value))
                {
                    SearchQueryChanged?.Invoke(this, value);
                }
            }
        }

        [DataMember]
        public ObservableCollection<SearchResultViewModel> Results
        {
            get => _results;
            set => SetProperty(ref _results, value);
        }

        [DataMember]
        public SearchResultViewModel? SelectedResult
        {
            get => _selectedResult;
            set
            {
                if (SetProperty(ref _selectedResult, value))
                {
                }
            }
        }

        // Keep this if we need it for something else, or if the view models link back
        [DataMember]
        public IAsyncCommand? OpenResultCommand
        {
            get => _openResultCommand;
            set => SetProperty(ref _openResultCommand, value);
        }

        [DataMember]
        public IAsyncCommand? FilterCommand
        {
             get => _filterCommand;
             set => SetProperty(ref _filterCommand, value);
        }

        public event EventHandler<string>? SearchQueryChanged;
    }

    [DataContract]
    public class SearchResultViewModel : NotifyPropertyChangedObject
    {
        private readonly SearchResult? _result;
        private IAsyncCommand? _openCommand;

        // Default constructor for serialization
        public SearchResultViewModel()
        {
            _result = null;
        }

        public SearchResultViewModel(SearchResult result, IAsyncCommand? openCommand)
        {
            _result = result;
            _openCommand = openCommand;
        }

        public SearchResult? GetResult() => _result;

        [DataMember]
        public string Name => _result?.item.name ?? "";

        [DataMember]
        public string Detail => _result != null ? $"{_result.item.filePath}:{_result.item.line}" : "";

        [DataMember]
        public IAsyncCommand? OpenCommand
        {
            get => _openCommand;
            set => SetProperty(ref _openCommand, value);
        }
    }

    public class SearchToolWindowContent : RemoteUserControl
    {
        private readonly ExtensionEntrypoint _extension;
        private SearchScope _currentScope = SearchScope.EVERYTHING;
        private readonly SearchToolWindowContentData _data;

        // Cancellation for debouncing
        private CancellationTokenSource? _searchCts;

        public SearchToolWindowContent(ExtensionEntrypoint extension)
            : base(new SearchToolWindowContentData())
        {
            _extension = extension;
            _data = (SearchToolWindowContentData)this.DataContext!;
            _data.SearchQueryChanged += OnSearchQueryChanged;

            // Define Commands
            _data.OpenResultCommand = new AsyncCommand(OnOpenResultAsync);
            _data.FilterCommand = new AsyncCommand(OnFilterAsync);
        }

        private async void OnSearchQueryChanged(object? sender, string query)
        {
             // Cancel previous search
             _searchCts?.Cancel();
             _searchCts = new CancellationTokenSource();
             var token = _searchCts.Token;

             if (string.IsNullOrWhiteSpace(query))
             {
                 _data.Results.Clear();
                 return;
             }

             try
             {
                 // Debounce logic
                 await Task.Delay(100, token);

                 if (token.IsCancellationRequested) return;

                 if (_extension.LspService != null)
                 {
                     if (!_extension.LspService.IsInitialized)
                     {
                         return;
                     }

                     // Perform search
                     var searchResults = await _extension.LspService.BurstSearchAsync(query, _currentScope);

                     if (token.IsCancellationRequested) return;

                     // Update UI
                     _data.Results.Clear();
                     foreach (var res in searchResults)
                     {
                         _data.Results.Add(new SearchResultViewModel(res, _data.OpenResultCommand));
                     }
                 }
             }
             catch (TaskCanceledException)
             {
                 // Ignore
             }
             catch (Exception ex)
             {
                 System.Diagnostics.Debug.WriteLine($"Search error: {ex}");
             }
        }

        private async Task OnOpenResultAsync(object? parameter, CancellationToken cancellationToken)
        {
             if (parameter is SearchResultViewModel vm)
             {
                 var result = vm.GetResult();
                 if (result == null) return;

                 var filePath = result.item.filePath;

                 if (!string.IsNullOrEmpty(filePath))
                 {
                      try
                      {
                           var uri = new Uri(filePath);
                           await _extension.Shell.Documents().OpenAsync(uri, cancellationToken);
                      }
                      catch (Exception ex)
                      {
                          System.Diagnostics.Debug.WriteLine($"Failed to open file: {ex}");
                      }
                 }
             }
        }

        private async Task OnFilterAsync(object? parameter, CancellationToken cancellationToken)
        {
             if (parameter is string scopeStr && Enum.TryParse<SearchScope>(scopeStr, true, out var scope))
             {
                 _currentScope = scope;
                 // Re-trigger search
                 OnSearchQueryChanged(this, _data.SearchQuery);
             }
        }
    }
}
