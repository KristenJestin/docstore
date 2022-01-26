using Docstore.Domain.Entities;

namespace Docstore.Application.Interfaces
{
    public interface IGenericRepository<T> where T : BaseEntity
    {
        Task<T?> FindByIdAsync(int id);
        Task<IReadOnlyList<T>> FindByIdsAsync(params int[] ids);
        Task<IReadOnlyList<T>> GetAllAsync();
        Task<T> AddAsync(T entity, bool save = false);
        Task UpdateAsync(T entity, bool save = false);
        Task DeleteAsync(T entity, bool save = false);
    }
}
