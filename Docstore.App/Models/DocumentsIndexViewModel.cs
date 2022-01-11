using Docstore.Domain.Entities;

namespace Docstore.App.Models
{
    public class DocumentsIndexViewModel
    {
        public IEnumerable<Document> Documents { get; set; } = Enumerable.Empty<Document>();
        public int? FolderId { get; set; }
    }
}
