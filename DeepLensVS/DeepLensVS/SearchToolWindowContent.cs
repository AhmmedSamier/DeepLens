namespace DeepLensVS
{
    using Microsoft.VisualStudio.Extensibility.UI;

    /// <summary>
    /// A RemoteUserControl to be displayed in the tool window.
    /// </summary>
    internal class SearchToolWindowContent : RemoteUserControl
    {
        /// <summary>
        /// Initializes a new instance of the <see cref="SearchToolWindowContent" /> class.
        /// </summary>
        /// <param name="dataContext">The data context for the control.</param>
        public SearchToolWindowContent(object dataContext)
            : base(dataContext)
        {
        }
    }
}
