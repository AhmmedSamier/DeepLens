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
                     // Trigger navigation or command?
                     // Usually better to have a command invoked by UI interaction
                }
            }
        }

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
        private readonly SearchResult _result;

        public SearchResultViewModel(SearchResult result)
        {
            _result = result;
        }

        public SearchResult GetResult() => _result;

        [DataMember]
        public string Name => _result.item.name;

        [DataMember]
        public string Detail => $"{_result.item.filePath}:{_result.item.line}";
    }

    public class SearchToolWindowContent : RemoteUserControl
    {
        private readonly ExtensionEntrypoint _extension;
        private SearchScope _currentScope = SearchScope.EVERYTHING;
        private readonly SearchToolWindowContentData _data;

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
             if (string.IsNullOrWhiteSpace(query))
             {
                 _data.Results.Clear();
                 return;
             }

             if (_extension.LspService != null)
             {
                 // Check if initialized
                 if (!_extension.LspService.IsInitialized)
                 {
                     // Attempt to init or just warn?
                     // Ideally we would try to init here but we lack the context/path easily.
                     // We can try to rely on the fallback logic in Command if we could invoke it.
                     // For now, we will just return empty or maybe a placeholder "Indexing..."

                     // We could await _extension.EnsureLspInitializedAsync() if implemented properly,
                     // but that stub doesn't have the path.
                     return;
                 }

                 var searchResults = await _extension.LspService.BurstSearchAsync(query, _currentScope);

                 _data.Results.Clear();
                 foreach (var res in searchResults)
                 {
                     _data.Results.Add(new SearchResultViewModel(res));
                 }
             }
        }

        private async Task OnOpenResultAsync(object? parameter, CancellationToken cancellationToken)
        {
             if (parameter is SearchResultViewModel vm)
             {
                 var result = vm.GetResult();
                 var filePath = result.item.filePath;

                 // If LSP is running, paths should be absolute.
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
