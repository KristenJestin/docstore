using Docstore.App.Models.Forms;

namespace Docstore.App.Models.Abstracts
{
    public abstract class FolderFormViewModel
    {
        public FolderForm Form { get; set; }

        public FolderFormViewModel()
        {
            Form = GetDefaultFormValues();
        }

        #region statics
        public static FolderForm GetDefaultFormValues() => new();
        #endregion
    }
}
