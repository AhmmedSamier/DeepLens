using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;

namespace DeepLensVisualStudio.ToolWindows
{
    /// <summary>
    /// Tool window for the DeepLens search functionality.
    /// This window hosts the SearchControl and integrates with VS's focus management.
    /// </summary>
    [Guid("b2c3d4e5-f6a7-4b5c-9d8e-7f6a5b4c3d2e")]
    public class SearchToolWindow : ToolWindowPane
    {
        private readonly SearchControl _searchControl;

        /// <summary>
        /// Initializes a new instance of the SearchToolWindow class.
        /// </summary>
        public SearchToolWindow() : base(null)
        {
            this.Caption = "DeepLens Search";
            _searchControl = new SearchControl(this);
            this.Content = _searchControl;
        }

        /// <summary>
        /// Gets the SearchControl instance hosted in this tool window.
        /// </summary>
        public SearchControl SearchControl => _searchControl;

        /// <summary>
        /// Sets the initial search text in the search control.
        /// </summary>
        public void SetInitialSearchText(string text)
        {
            _searchControl?.SetInitialSearchText(text);
        }

        /// <summary>
        /// Focuses the search textbox when the tool window is shown.
        /// </summary>
        public void FocusSearchBox()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            
            // Use Dispatcher to focus after the window is fully shown
            _searchControl?.Dispatcher.BeginInvoke(new Action(() =>
            {
                var searchTextBox = _searchControl.FindName("SearchTextBox") as System.Windows.Controls.TextBox;
                if (searchTextBox != null)
                {
                    searchTextBox.Focus();
                    searchTextBox.SelectAll();
                    System.Windows.Input.Keyboard.Focus(searchTextBox);
                }
            }), System.Windows.Threading.DispatcherPriority.Loaded);
        }
    }
}
