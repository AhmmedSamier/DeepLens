using System;
using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.ComponentModelHost;
using Microsoft.VisualStudio.LanguageServices;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.VisualStudio;

namespace DeepLens.VisualStudio.Search
{
    [Guid("87654321-4321-4321-4321-098765432109")]
    public class SearchToolWindow : ToolWindowPane
    {
        public SearchToolWindow() : base(null)
        {
            this.Caption = "DeepLens Search";
            this.Content = new SearchWindow();
        }

        public override void OnToolWindowCreated()
        {
            var componentModel = (IComponentModel)GetService(typeof(SComponentModel));
            if (componentModel != null)
            {
                var workspace = componentModel.GetService<VisualStudioWorkspace>();
                if (this.Content is SearchWindow window)
                {
                    window.SetWorkspace(workspace);
                    window.OnNavigate += NavigateToResult;
                }
            }
        }

        private void NavigateToResult(Services.SearchResult result)
        {
            ThreadHelper.ThrowIfNotOnUIThread();

            if (string.IsNullOrEmpty(result.FilePath)) return;

            try
            {
                VsShellUtilities.OpenDocument(this, result.FilePath, Guid.Empty, out var hierarchy, out var itemId, out var windowFrame);

                if (windowFrame != null)
                {
                    windowFrame.Show();

                    if (result.LineNumber >= 0)
                    {
                        var textView = VsShellUtilities.GetTextView(windowFrame);
                        if (textView != null)
                        {
                            textView.SetCaretPos(result.LineNumber, 0);
                            textView.CenterLines(result.LineNumber, 1);
                        }
                    }
                }
            }
            catch (Exception)
            {
                // Handle or log error
            }
        }
    }
}
