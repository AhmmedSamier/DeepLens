using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Linq;
using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;

namespace DeepLensVisualStudio.Services
{
    /// <summary>
    /// Options page for DeepLens settings in Tools > Options.
    /// </summary>
    [ClassInterface(ClassInterfaceType.AutoDual)]
    [ComVisible(true)]
    [Guid("B1C2D3E4-F5A6-4B7C-9D8E-7F6A5B4C3D2E")]
    public class DeepLensOptionsPage : DialogPage
    {
        private DeepLensSettings? _settings;

        private DeepLensSettings Settings
        {
            get
            {
                if (_settings == null)
                {
                    _settings = new DeepLensSettings();
                }
                return _settings;
            }
        }

        // Search Configuration
        [Category("Search")]
        [DisplayName("Maximum Results")]
        [Description("Maximum number of search results to display")]
        public int MaxResults
        {
            get => Settings.MaxResults;
            set => Settings.MaxResults = value;
        }

        [Category("Search")]
        [DisplayName("Enable Text Search")]
        [Description("Enable full-text search across files")]
        public bool EnableTextSearch
        {
            get => Settings.EnableTextSearch;
            set => Settings.EnableTextSearch = value;
        }

        [Category("Search")]
        [DisplayName("Enable CamelHumps")]
        [Description("Enable CamelHumps matching (e.g., 'RFC' matches 'React.FC')")]
        public bool EnableCamelHumps
        {
            get => Settings.EnableCamelHumps;
            set => Settings.EnableCamelHumps = value;
        }

        [Category("Search")]
        [DisplayName("Respect .gitignore")]
        [Description("Respect .gitignore files when indexing (recommended)")]
        public bool RespectGitignore
        {
            get => Settings.RespectGitignore;
            set => Settings.RespectGitignore = value;
        }

        [Category("Search")]
        [DisplayName("Search Concurrency")]
        [Description("Number of files to scan in parallel during text search (1-200). Higher values are faster but use more CPU/IO.")]
        public int SearchConcurrency
        {
            get => Settings.SearchConcurrency;
            set => Settings.SearchConcurrency = value;
        }

        // Activity Tracking
        [Category("Activity Tracking")]
        [DisplayName("Enable Activity Tracking")]
        [Description("Enable personalized results based on your usage activity")]
        public bool ActivityEnabled
        {
            get => Settings.ActivityEnabled;
            set => Settings.ActivityEnabled = value;
        }

        [Category("Activity Tracking")]
        [DisplayName("Activity Weight")]
        [Description("How much activity affects results (0=none, 0.5=balanced, 1=only activity)")]
        public double ActivityWeight
        {
            get => Settings.ActivityWeight;
            set => Settings.ActivityWeight = value;
        }

        // CodeLens Configuration
        [Category("CodeLens")]
        [DisplayName("Enable CodeLens")]
        [Description("Show reference counts above classes and functions (like Rider's Code Vision)")]
        public bool CodeLensEnabled
        {
            get => Settings.CodeLensEnabled;
            set => Settings.CodeLensEnabled = value;
        }

        [Category("CodeLens")]
        [DisplayName("Show Implementations")]
        [Description("Show implementation counts above classes, interfaces and methods (Ctrl+F12)")]
        public bool CodeLensShowImplementations
        {
            get => Settings.CodeLensShowImplementations;
            set => Settings.CodeLensShowImplementations = value;
        }

        [Category("CodeLens")]
        [DisplayName("Minimum References to Show")]
        [Description("Minimum number of references to display code lens (0 = show all, including 'no references')")]
        public int CodeLensMinRefsToShow
        {
            get => Settings.CodeLensMinRefsToShow;
            set => Settings.CodeLensMinRefsToShow = value;
        }

        // File Extensions
        [Category("Indexing")]
        [DisplayName("File Extensions")]
        [Description("File extensions to index for search (comma-separated)")]
        public string FileExtensions
        {
            get => string.Join(", ", Settings.FileExtensions);
            set
            {
                var extensions = value.Split(new[] { ',', ';' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(e => e.Trim())
                    .Where(e => !string.IsNullOrEmpty(e))
                    .ToList();
                Settings.FileExtensions = extensions;
            }
        }

        // Exclude Patterns
        [Category("Indexing")]
        [DisplayName("Exclude Patterns")]
        [Description("Glob patterns to exclude from indexing (one per line)")]
        public string ExcludePatterns
        {
            get => string.Join("\n", Settings.ExcludePatterns);
            set
            {
                var patterns = value.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries)
                    .Select(p => p.Trim())
                    .Where(p => !string.IsNullOrEmpty(p))
                    .ToList();
                Settings.ExcludePatterns = patterns;
            }
        }

        // Experimental Features
        [Category("Experimental")]
        [DisplayName("Enable File Icons")]
        [Description("Enable native file icons in search results")]
        public bool EnableFileIcons
        {
            get => Settings.EnableFileIcons;
            set => Settings.EnableFileIcons = value;
        }

        protected override void OnApply(PageApplyEventArgs e)
        {
            base.OnApply(e);
            // Settings are automatically saved via the Settings property setters
        }
    }
}
