using Docstore.Application.Interfaces;
using Docstore.Domain.Entities;
using Docstore.Persistence.Contexts;
using Microsoft.EntityFrameworkCore;

namespace Docstore.Persistence.Repositories
{
    public class DocumentFileRepository : GenericRepository<DocumentFile>, IDocumentFileRepository
    {
        private readonly DbSet<DocumentFile> _files;
        public DocumentFileRepository(ApplicationDbContext db) : base(db)
        {
            _files = db.Set<DocumentFile>();
        }

        public async Task<IReadOnlyList<DocumentFile>> GetFromParentAsync(int userId, int parentId)
            => await _files
                .Where(x => x.UserId == userId)
                .Where(x => x.DocumentId == parentId)
                .OrderBy(x => x.Order)
                .ToListAsync();
    }
}
