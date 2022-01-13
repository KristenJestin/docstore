using Docstore.Domain.Entities;

namespace Docstore.App.Models
{
    public class HomeIndexViewModel
    {
        public IEnumerable<Document> LastDocuments { get; set; } = Enumerable.Empty<Document>();
        public IEnumerable<Document> Documents { get; set; } = Enumerable.Empty<Document>();
        public IEnumerable<Folder> Folders { get; set; } = Enumerable.Empty<Folder>();
    }
}
