using Docstore.Application.Models;
using Docstore.Domain.Entities;

namespace Docstore.App.Models
{
    public class DocumentsIndexViewModel
    {
        public PagedResult<Document> Documents { get; set; } = PagedResult<Document>.Empty<Document>();
        public int? FolderId { get; set; }
        public Folder? Folder { get; set; }
    }
}
