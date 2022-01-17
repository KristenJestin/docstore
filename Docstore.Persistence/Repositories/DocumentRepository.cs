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

        public DocumentRepository(AppDbContext db) : base(db)
        {
            _documents = db.Set<Document>();
        }

        public async Task<PagedResult<Document>> GetPagedReponseAsync(int pageNumber, int pageSize, string? search = null, int? tag = null, int? folder = null, Expression<Func<Document, bool>>? where = null)
        {
            IQueryable<Document> query = _documents;

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

        public async Task<Document?> FindByIdWithTypeAndTagsAndFileAsync(int id)
            => await _documents
                .Include(d => d.Tags)
                .Include(d => d.Files)
                .FirstOrDefaultAsync(d => d.Id == id);
    }
}
