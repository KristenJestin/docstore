using Docstore.Application.Interfaces;
using Docstore.Domain.Entities;
using Docstore.Persistence.Contexts;
using Microsoft.EntityFrameworkCore;

namespace Docstore.Persistence.Repositories
{
    public class FolderRepository : GenericRepository<Folder>, IFolderRepository
    {
        private readonly DbSet<Folder> _folders;

        public FolderRepository(AppDbContext db) : base(db)
        {
            _folders = db.Set<Folder>();
        }

        public async Task<IEnumerable<Folder>> SearchAsync(string term, uint size = 10)
            => await _folders
                .Where(f => f.Name != null && f.Name.ToLower().Contains(term.ToLower()))
                .Take(10)
                .ToListAsync();
    }
}
