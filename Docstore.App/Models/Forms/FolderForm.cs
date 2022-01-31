using System.ComponentModel.DataAnnotations;

namespace Docstore.App.Models.Forms
{
    public class FolderForm
    {
        public string? Name { get; set; }

        [DataType(DataType.MultilineText)]
        public string? Description { get; set; }
    }
}
