using System.Runtime.Serialization;
using System.Text.Json.Serialization;

namespace DeepLensVS
{
    [DataContract]
    public class LspSearchOptions
    {
        [DataMember(Name = "query")]
        [JsonPropertyName("query")]
        public string Query { get; set; } = string.Empty;

        [DataMember(Name = "scope")]
        [JsonPropertyName("scope")]
        public string Scope { get; set; } = "everything";

        [DataMember(Name = "maxResults")]
        [JsonPropertyName("maxResults")]
        public int? MaxResults { get; set; }

        [DataMember(Name = "enableCamelHumps")]
        [JsonPropertyName("enableCamelHumps")]
        public bool? EnableCamelHumps { get; set; }
    }

    [DataContract]
    public class LspSearchResult
    {
        [DataMember(Name = "item")]
        [JsonPropertyName("item")]
        public LspSearchableItem Item { get; set; } = new();

        [DataMember(Name = "score")]
        [JsonPropertyName("score")]
        public double Score { get; set; }

        [DataMember(Name = "scope")]
        [JsonPropertyName("scope")]
        public string Scope { get; set; } = string.Empty;
    }

    [DataContract]
    public class LspSearchableItem
    {
        [DataMember(Name = "id")]
        [JsonPropertyName("id")]
        public string Id { get; set; } = string.Empty;

        [DataMember(Name = "name")]
        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [DataMember(Name = "type")]
        [JsonPropertyName("type")]
        public string Type { get; set; } = string.Empty;

        [DataMember(Name = "filePath")]
        [JsonPropertyName("filePath")]
        public string FilePath { get; set; } = string.Empty;

        [DataMember(Name = "relativeFilePath")]
        [JsonPropertyName("relativeFilePath")]
        public string? RelativeFilePath { get; set; }

        [DataMember(Name = "line")]
        [JsonPropertyName("line")]
        public int? Line { get; set; }

        [DataMember(Name = "column")]
        [JsonPropertyName("column")]
        public int? Column { get; set; }

        [DataMember(Name = "containerName")]
        [JsonPropertyName("containerName")]
        public string? ContainerName { get; set; }

        [DataMember(Name = "detail")]
        [JsonPropertyName("detail")]
        public string? Detail { get; set; }
    }
}
