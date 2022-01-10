using Docstore.App.Data;

namespace Docstore.App.Models
{
    public class DocumentsIndexViewModel
    {
        public IEnumerable<Document> Documents { get; set; } = new List<Document>();
    }
}
