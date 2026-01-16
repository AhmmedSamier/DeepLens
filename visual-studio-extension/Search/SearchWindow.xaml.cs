using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Microsoft.CodeAnalysis;
using DeepLens.VisualStudio.Services;

namespace DeepLens.VisualStudio.Search
{
    public partial class SearchWindow : UserControl
    {
        private RoslynSearchService _searchService;
        private CancellationTokenSource _cts;

        public SearchWindow()
        {
            InitializeComponent();
        }

        public void SetWorkspace(Workspace workspace)
        {
            _searchService = new RoslynSearchService(workspace);
        }

        private async void SearchBox_TextChanged(object sender, TextChangedEventArgs e)
        {
            if (_searchService == null) return;

            var query = SearchBox.Text;

            _cts?.Cancel();
            _cts = new CancellationTokenSource();
            var token = _cts.Token;

            try
            {
                await Task.Delay(100, token); // 100ms debounce

                var results = await _searchService.SearchAsync(query, token);

                if (!token.IsCancellationRequested)
                {
                    ResultsList.ItemsSource = results;
                }
            }
            catch (OperationCanceledException)
            {
                // Ignore
            }
            catch (Exception)
            {
                // Log or ignore
            }
        }

        private void ResultsList_MouseDoubleClick(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
             if (ResultsList.SelectedItem is SearchResult result)
             {
                 OnNavigate?.Invoke(result);
             }
        }

        public event Action<SearchResult> OnNavigate;
    }
}
