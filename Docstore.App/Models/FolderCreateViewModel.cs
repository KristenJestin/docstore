using Docstore.App.Models.Forms;

namespace Docstore.App.Models
{
    public class FolderCreateViewModel
    {
        public FolderCreateForm Form { get; set; }


        public FolderCreateViewModel()
        {
            Form = GetDefaultFormValues();
        }


        #region statics
        public static FolderCreateForm GetDefaultFormValues() => new();
        #endregion
    }
}
