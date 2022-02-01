using Newtonsoft.Json;

namespace Docstore.Application.Models
{
    public class ManifestAsset
    {
        [JsonProperty("file")]
        public string? File { get; set; }

        [JsonProperty("src")]
        public string? Src { get; set; }

        [JsonProperty("isEntry")]
        public bool? IsEntry { get; set; }

        [JsonProperty("imports")]
        public IEnumerable<string> Imports { get; set; } = new List<string>();

        [JsonProperty("css")]
        public IEnumerable<string> Css { get; set; } = Enumerable.Empty<string>();
    }
}
