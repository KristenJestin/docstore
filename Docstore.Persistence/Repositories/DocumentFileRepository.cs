using Docstore.Application.Interfaces;
using Docstore.Domain.Entities;
using Docstore.Persistence.Contexts;

namespace Docstore.Persistence.Repositories
{
    public class DocumentFileRepository : GenericRepository<DocumentFile>, IDocumentFileRepository
    {
        public DocumentFileRepository(ApplicationDbContext db) : base(db)
        {
        }
    }
}
