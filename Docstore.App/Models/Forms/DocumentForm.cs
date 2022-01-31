using Newtonsoft.Json;
using System.ComponentModel.DataAnnotations;

namespace Docstore.App.Models.Forms
{
    public class DocumentForm
    {
        public string? Name { get; set; }

        [DataType(DataType.MultilineText)]
        public string? Description { get; set; }
        public IEnumerable<int> Files { get; set; } = new List<int>();

        public IEnumerable<string> Tags { get; set; } = new List<string>();

        public int? FolderId { get; set; }

        public DateTime? ReceivedAt { get; set; }
        public DateTime? EndsAt { get; set; }


        #region methods
        public string GetTagsJavascriptData()
            => JsonConvert.SerializeObject(Tags, Formatting.None);
        #endregion
    }
}
