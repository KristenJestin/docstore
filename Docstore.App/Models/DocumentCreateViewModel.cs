using Docstore.App.Models.Forms;
using Docstore.Domain.Entities;

namespace Docstore.App.Models
{
    public class DocumentCreateViewModel
    {
        public DocumentCreateForm Form { get; set; }

        public int? FolderId { get; set; }
        public Folder? Folder { get; set; }


        public DocumentCreateViewModel(int? folderId = null, Folder? folder = null)
        {
            Form = GetDefaultFormValues(folderId);

            FolderId = folderId;
            Folder = folder;
        }


        #region statics
        public static DocumentCreateForm GetDefaultFormValues(int? folderId = null) => new() { FolderId = folderId };
        #endregion
    }
}
