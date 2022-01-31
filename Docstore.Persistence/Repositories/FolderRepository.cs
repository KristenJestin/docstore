using Docstore.Application.Extensions;
using Docstore.Application.Interfaces;
using Docstore.Application.Models;
using Docstore.Domain.Entities;
using Docstore.Domain.Extensions;
using Docstore.Persistence.Contexts;
using Microsoft.EntityFrameworkCore;
using System.Linq.Expressions;

namespace Docstore.Persistence.Repositories
{
    public class FolderRepository : GenericRepository<Folder>, IFolderRepository
    {
        private readonly DbSet<Folder> _folders;

        public FolderRepository(ApplicationDbContext db) : base(db)
        {
            _folders = db.Set<Folder>();
        }


        public override Task<Folder?> FindByIdAsync(int userId, int id)
            => _folders
                .Where(x => x.UserId == userId && x.Id == id)
                .Select(f => f.WithDocumentsCount(f.Documents.Count).WithSize(f.Documents.Sum(docu => docu.Files.Sum(file => file.Size))))
                //.AsNoTracking()
                .FirstOrDefaultAsync();

        public async Task<PagedResult<Folder>> GetPagedReponseAsync(int userId, int pageNumber, int pageSize, string? search = null, Expression<Func<Folder, bool>>? where = null)
        {
            IQueryable<Folder> query = _folders.Where(x => x.UserId == userId);

            #region parameters
            if (!string.IsNullOrWhiteSpace(search))
                query = query.Where(d => d.Name!.Contains(search));

            if (where != null)
                query = query
                    .Where(where);
            #endregion

            // total
            var count = await query.CountAsync();
            // paginations
            query = query
                .Paginate(pageNumber, pageSize)
                .OrderBy(d => d.Name)
                // TODO: save in database size and count when inserting and updating files
                .Select(f => f.WithDocumentsCount(f.Documents.Count).WithSize(f.Documents.Sum(docu => docu.Files.Sum(file => file.Size))))
                .AsNoTracking();

            // list documents
            return new PagedResult<Folder>(await query.ToListAsync(), count, pageNumber, pageSize);
        }

        public async Task<IEnumerable<Folder>> SearchAsync(int userId, string term, uint size = 10)
            => await _folders
                .Where(f => f.UserId == userId)
                .Where(f => f.Name != null && f.Name.ToLower().Contains(term.ToLower()))
                .Take(10)
                .ToListAsync();
    }
}
