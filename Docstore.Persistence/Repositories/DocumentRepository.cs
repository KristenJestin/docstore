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
    public class DocumentRepository : GenericRepository<Document>, IDocumentRepository
    {
        private readonly DbSet<Document> _documents;

        public DocumentRepository(ApplicationDbContext db) : base(db)
        {
            _documents = db.Set<Document>();
        }

        public override async Task<Document?> FindByIdAsync(int userId, int id)
            => await _documents
                .Where(x => x.UserId == userId && x.Id == id)
                .Include(x => x.Folder)
                .Include(x => x.Tags)
                .Include(x => x.Files)
                //.AsNoTracking()
                .FirstOrDefaultAsync();

        public async Task<PagedResult<Document>> GetPagedReponseAsync(int userId, int pageNumber, int pageSize, string? search = null, int? tag = null, int? folder = null, Expression<Func<Document, bool>>? where = null)
        {
            IQueryable<Document> query = _documents.Where(x => x.UserId == userId);

            #region parameters
            if (!string.IsNullOrWhiteSpace(search))
                query = query.Where(d => d.Name!.Contains(search));

            if (tag != null)
                query = query
                    .Where(d => d.Tags.Any(t => t.Id == tag.Value));

            if (folder != null)
                query = query
                    .Where(d => d.FolderId == folder);

            if (where != null)
                query = query
                    .Where(where);
            #endregion

            // total
            var count = await query.CountAsync();
            // paginations
            query = query
                .Include(d => d.Tags)
                .Paginate(pageNumber, pageSize)
                .OrderBy(d => d.Name)
                // TODO: save in database size and count when inserting and updating files
                .Select(d => d.WithFilesCount(d.Files.Count).WithSize(d.Files.Sum(file => file.Size)))
                .AsNoTracking();

            // list documents
            return new PagedResult<Document>(await query.ToListAsync(), count, pageNumber, pageSize);
        }

        public async Task<Document?> FindByIdWithTypeAndTagsAndFileAsync(int userId, int id)
            => await _documents
                .Where(x => x.UserId == userId)
                .Include(x => x.Files)
                .Include(x => x.Tags)
                .Include(x => x.Folder)
                .AsNoTracking()
                .FirstOrDefaultAsync(x => x.Id == id);

        public async Task<IReadOnlyList<Document>> GetLastAsync(int userId, uint size = 3)
            => await _documents
                .Where(d => d.UserId == userId)
                .OrderByDescending(d => d.UpdatedAt)
                .Include(d => d.Folder)
                .Include(d => d.Tags)
                .Take((int)size)
                .ToListAsync();
    }
}
