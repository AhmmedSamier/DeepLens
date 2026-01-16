using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace DeepLens.VisualStudio.Services
{
    public class SearchResult
    {
        public string Name { get; set; }
        public string Kind { get; set; } // "Class", "Method", "File", etc.
        public string FilePath { get; set; }
        public int LineNumber { get; set; }
        public string Container { get; set; }

        public override string ToString() => $"{Name} ({Kind}) - {FilePath}";
    }

    public class RoslynSearchService
    {
        private readonly Workspace _workspace;
        // Simple cache: ProjectId -> List<SearchResult>
        private readonly ConcurrentDictionary<ProjectId, List<SearchResult>> _cache = new ConcurrentDictionary<ProjectId, List<SearchResult>>();

        public RoslynSearchService(Workspace workspace)
        {
            _workspace = workspace;
            if (_workspace != null)
            {
                _workspace.WorkspaceChanged += OnWorkspaceChanged;
            }
        }

        private void OnWorkspaceChanged(object sender, WorkspaceChangeEventArgs e)
        {
            // Invalidate cache for changed project
            if (e.ProjectId != null)
            {
                _cache.TryRemove(e.ProjectId, out _);
            }
        }

        public async Task<List<SearchResult>> SearchAsync(string query, CancellationToken cancellationToken)
        {
            if (_workspace == null) return new List<SearchResult>();

            var solution = _workspace.CurrentSolution;
            var allResults = new List<SearchResult>();

            foreach (var project in solution.Projects)
            {
                if (project.Language != LanguageNames.CSharp) continue;

                var projectItems = await GetProjectItemsAsync(project, cancellationToken);

                // Filter
                foreach (var item in projectItems)
                {
                    if (FuzzyMatcher.IsMatch(query, item.Name))
                    {
                        allResults.Add(item);
                    }
                }
            }

            return allResults;
        }

        private async Task<List<SearchResult>> GetProjectItemsAsync(Project project, CancellationToken cancellationToken)
        {
            if (_cache.TryGetValue(project.Id, out var cached))
            {
                return cached;
            }

            var items = new List<SearchResult>();

            foreach (var document in project.Documents)
            {
                // File match candidate
                items.Add(new SearchResult
                {
                    Name = document.Name,
                    Kind = "File",
                    FilePath = document.FilePath,
                    LineNumber = 0
                });

                // Symbol extraction
                // We parse the syntax tree.
                SyntaxNode syntaxRoot = null;
                try
                {
                    syntaxRoot = await document.GetSyntaxRootAsync(cancellationToken);
                }
                catch
                {
                    // Ignore errors
                }

                if (syntaxRoot == null) continue;

                var nodes = syntaxRoot.DescendantNodes()
                    .OfType<MemberDeclarationSyntax>();

                foreach (var node in nodes)
                {
                    string name = null;
                    string kind = null;

                    if (node is ClassDeclarationSyntax cls)
                    {
                        name = cls.Identifier.Text;
                        kind = "Class";
                    }
                    else if (node is MethodDeclarationSyntax method)
                    {
                        name = method.Identifier.Text;
                        kind = "Method";
                    }
                    else if (node is PropertyDeclarationSyntax prop)
                    {
                        name = prop.Identifier.Text;
                        kind = "Property";
                    }
                    else if (node is InterfaceDeclarationSyntax iface)
                    {
                        name = iface.Identifier.Text;
                        kind = "Interface";
                    }
                    else if (node is StructDeclarationSyntax str)
                    {
                        name = str.Identifier.Text;
                        kind = "Struct";
                    }
                    else if (node is EnumDeclarationSyntax enm)
                    {
                        name = enm.Identifier.Text;
                        kind = "Enum";
                    }

                    if (!string.IsNullOrEmpty(name))
                    {
                        var lineSpan = node.GetLocation().GetLineSpan();
                        items.Add(new SearchResult
                        {
                            Name = name,
                            Kind = kind,
                            FilePath = document.FilePath,
                            LineNumber = lineSpan.StartLinePosition.Line
                        });
                    }
                }
            }

            _cache.TryAdd(project.Id, items);
            return items;
        }
    }
}
