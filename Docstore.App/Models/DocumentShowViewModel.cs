using Docstore.Domain.Entities;

namespace Docstore.App.Models
{
    public class DocumentShowViewModel
    {
        public Document Document { get; set; }

        public DocumentShowViewModel(Document document)
        {
            Document = document;
        }
    }
}
