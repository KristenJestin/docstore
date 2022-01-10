using Docstore.App.Models.Forms;

namespace Docstore.App.Models
{
    public class DocumentCreateViewModel
    {
        public DocumentCreateForm Form { get; set; }


        public DocumentCreateViewModel()
        {
            Form = DefaultFormValues;
        }


        #region statics
        public static DocumentCreateForm DefaultFormValues => new();
        #endregion
    }
}
