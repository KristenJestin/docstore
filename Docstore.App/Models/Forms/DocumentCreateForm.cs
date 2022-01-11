using Newtonsoft.Json;
using System.ComponentModel.DataAnnotations;

namespace Docstore.App.Models.Forms
{
    public class DocumentCreateForm
    {
        public string? Name { get; set; }

        [DataType(DataType.MultilineText)]
        public string? Description { get; set; }

        public IFormFileCollection Files { get; set; } = new FormFileCollection();

        public IEnumerable<string> Tags { get; set; } = new List<string>();

        public int? FolderId { get; set; }


        #region methods
        public string GetTagsJavascriptData()
            => JsonConvert.SerializeObject(Tags, Formatting.None);
        #endregion
    }
}
