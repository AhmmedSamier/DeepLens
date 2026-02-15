using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.VisualStudio.Settings;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Settings;

namespace DeepLensVisualStudio.Services
{
    /// <summary>
    /// Wrapper class for accessing DeepLens settings from Visual Studio settings store.
    /// </summary>
    public class DeepLensSettings
    {
        private const string CollectionPath = "DeepLens";
        private readonly WritableSettingsStore _settingsStore;

        public DeepLensSettings()
        {
            var settingsManager = new ShellSettingsManager(ServiceProvider.GlobalProvider);
            _settingsStore = settingsManager.GetWritableSettingsStore(SettingsScope.UserSettings);
            
            // Ensure collection exists
            if (!_settingsStore.CollectionExists(CollectionPath))
            {
                _settingsStore.CreateCollection(CollectionPath);
            }
        }

        // Search Configuration
        public int MaxResults
        {
            get => GetInt(nameof(MaxResults), 20);
            set => SetInt(nameof(MaxResults), value);
        }

        public bool EnableTextSearch
        {
            get => GetBool(nameof(EnableTextSearch), true);
            set => SetBool(nameof(EnableTextSearch), value);
        }

        public bool EnableCamelHumps
        {
            get => GetBool(nameof(EnableCamelHumps), true);
            set => SetBool(nameof(EnableCamelHumps), value);
        }

        public bool RespectGitignore
        {
            get => GetBool(nameof(RespectGitignore), true);
            set => SetBool(nameof(RespectGitignore), value);
        }

        public int SearchConcurrency
        {
            get => GetInt(nameof(SearchConcurrency), 60);
            set => SetInt(nameof(SearchConcurrency), Math.Max(1, Math.Min(value, 200)));
        }

        // Activity Tracking
        public bool ActivityEnabled
        {
            get => GetBool(nameof(ActivityEnabled), true);
            set => SetBool(nameof(ActivityEnabled), value);
        }

        public double ActivityWeight
        {
            get => GetDouble(nameof(ActivityWeight), 0.3);
            set => SetDouble(nameof(ActivityWeight), Math.Max(0.0, Math.Min(value, 1.0)));
        }

        // CodeLens Configuration
        public bool CodeLensEnabled
        {
            get => GetBool(nameof(CodeLensEnabled), true);
            set => SetBool(nameof(CodeLensEnabled), value);
        }

        public bool CodeLensShowImplementations
        {
            get => GetBool(nameof(CodeLensShowImplementations), true);
            set => SetBool(nameof(CodeLensShowImplementations), value);
        }

        public int CodeLensMinRefsToShow
        {
            get => GetInt(nameof(CodeLensMinRefsToShow), 0);
            set => SetInt(nameof(CodeLensMinRefsToShow), Math.Max(0, value));
        }

        // File Extensions
        public List<string> FileExtensions
        {
            get => GetStringList(nameof(FileExtensions), new[] { "ts", "tsx", "js", "jsx", "py", "java", "cs", "cpp", "c", "h", "go", "rb", "php" });
            set => SetStringList(nameof(FileExtensions), value);
        }

        // Exclude Patterns
        public List<string> ExcludePatterns
        {
            get => GetStringList(nameof(ExcludePatterns), new[] { "**/node_modules/**", "**/dist/**", "**/out/**", "**/.git/**", "**/build/**" });
            set => SetStringList(nameof(ExcludePatterns), value);
        }

        // Experimental Features
        public bool EnableFileIcons
        {
            get => GetBool(nameof(EnableFileIcons), false);
            set => SetBool(nameof(EnableFileIcons), value);
        }

        // Helper methods
        private bool GetBool(string propertyName, bool defaultValue)
        {
            try
            {
                if (_settingsStore.PropertyExists(CollectionPath, propertyName))
                {
                    return _settingsStore.GetBoolean(CollectionPath, propertyName);
                }
            }
            catch { }
            return defaultValue;
        }

        private void SetBool(string propertyName, bool value)
        {
            try
            {
                _settingsStore.SetBoolean(CollectionPath, propertyName, value);
            }
            catch { }
        }

        private int GetInt(string propertyName, int defaultValue)
        {
            try
            {
                if (_settingsStore.PropertyExists(CollectionPath, propertyName))
                {
                    return _settingsStore.GetInt32(CollectionPath, propertyName);
                }
            }
            catch { }
            return defaultValue;
        }

        private void SetInt(string propertyName, int value)
        {
            try
            {
                _settingsStore.SetInt32(CollectionPath, propertyName, value);
            }
            catch { }
        }

        private double GetDouble(string propertyName, double defaultValue)
        {
            try
            {
                if (_settingsStore.PropertyExists(CollectionPath, propertyName))
                {
                    // Store as string since IVsSettingsStore doesn't have GetDouble
                    var str = _settingsStore.GetString(CollectionPath, propertyName);
                    if (double.TryParse(str, out var result))
                    {
                        return result;
                    }
                }
            }
            catch { }
            return defaultValue;
        }

        private void SetDouble(string propertyName, double value)
        {
            try
            {
                _settingsStore.SetString(CollectionPath, propertyName, value.ToString("F2"));
            }
            catch { }
        }

        private List<string> GetStringList(string propertyName, string[] defaultValue)
        {
            try
            {
                if (_settingsStore.PropertyExists(CollectionPath, propertyName))
                {
                    var str = _settingsStore.GetString(CollectionPath, propertyName);
                    if (!string.IsNullOrEmpty(str))
                    {
                        return str.Split(new[] { '|' }, StringSplitOptions.RemoveEmptyEntries).ToList();
                    }
                }
            }
            catch { }
            return defaultValue.ToList();
        }

        private void SetStringList(string propertyName, List<string> value)
        {
            try
            {
                _settingsStore.SetString(CollectionPath, propertyName, string.Join("|", value));
            }
            catch { }
        }
    }
}
