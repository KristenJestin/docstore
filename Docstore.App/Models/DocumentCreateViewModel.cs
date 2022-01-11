using Docstore.App.Models.Forms;

namespace Docstore.App.Models
{
    public class DocumentCreateViewModel
    {
        public DocumentCreateForm Form { get; set; }

        public int? FolderId { get; set; }


        public DocumentCreateViewModel(int? folderId = null)
        {
            Form = GetDefaultFormValues(folderId);
            FolderId = folderId;
        }


        #region statics
        public static DocumentCreateForm GetDefaultFormValues(int? folderId = null) => new() { FolderId = folderId };
        #endregion
    }
}
